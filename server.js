require('dotenv').config();

const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const csv = require('csv-parser');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Postgres connection (Railway provides DATABASE_URL).
// Default is plain TCP: on Railway the app reaches Postgres over the private
// network (postgres.railway.internal). Set DATABASE_SSL=no-verify only when
// connecting through the public proxy, whose cert is self-signed.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'no-verify' ? { rejectUnauthorized: false } : false
});
const dbEnabled = !!process.env.DATABASE_URL;
if (!dbEnabled) {
  console.warn('DATABASE_URL not set: progress tracking disabled, quiz still works');
}

// MIS-168 H8. The progress API has no auth: the email address IS the
// identifier, so anyone can read, overwrite or reset anyone else's progress if
// they know or guess the address. Fixing that properly needs a real login
// (magic link) and is Robin's product call, not a patch. Until then, two
// mitigations that cost users nothing:
//
// 1. CORS is no longer a wildcard. `app.use(cors())` let ANY website run these
//    requests from a visitor's browser, with the visitor's network identity.
//    Now only this app's own origins can. It does not stop curl (nothing here
//    can), but it does stop a hostile page doing it silently on someone's
//    behalf. Override with ALLOWED_ORIGINS if the app is ever embedded.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://ml-exam-training-app-production.up.railway.app')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // Same-origin and non-browser callers send no Origin header; allow those,
    // since blocking them would break the app itself without stopping anyone.
    if (!origin) return cb(null, true);
    return cb(null, ALLOWED_ORIGINS.includes(origin));
  }
}));

// 2. A small in-process rate limit on the identity-keyed routes. Without this,
//    the email-as-identifier design is trivially enumerable: a script can walk
//    a wordlist and learn which addresses have progress stored. Deliberately
//    dependency-free rather than pulling in express-rate-limit, to avoid adding
//    supply chain to a live app for twenty lines of logic.
const rateBuckets = new Map(); // ip -> { count, resetAt }
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, b);
  }
  b.count++;
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (v.resetAt < now) rateBuckets.delete(k);
  }
  if (b.count > RATE_MAX) {
    res.set('Retry-After', Math.ceil((b.resetAt - now) / 1000));
    return res.status(429).json({ error: 'too many requests' });
  }
  next();
}

app.set('trust proxy', 1); // Railway terminates TLS; without this every request looks like one IP
app.use(['/api/progress', '/api/progress/save', '/api/progress/reset'], rateLimit);

app.use(express.json());
app.use(express.static('public'));

let questions = [];

// Deterministic per-question option shuffle, stable across restarts and deploys
// so saved answer letters keep pointing at the same option text.
function shuffleOptions(id, options, correctLetter) {
  const letters = ['A', 'B', 'C', 'D'];
  const entries = letters.map((k) => ({ key: k, text: options[k] }));
  const seed = crypto.createHash('sha256').update(`ml-exam:${id}`).digest();
  for (let i = entries.length - 1; i > 0; i--) {
    const j = seed[i] % (i + 1);
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  const newOptions = {};
  let newCorrect = 'A';
  entries.forEach((entry, idx) => {
    newOptions[letters[idx]] = entry.text;
    if (entry.key === correctLetter) newCorrect = letters[idx];
  });
  return { options: newOptions, correctLetter: newCorrect };
}

function loadQuestions() {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(path.join(__dirname, 'questions.csv'))
      .pipe(csv())
      .on('data', (row) => {
        const shuffled = shuffleOptions(row.id, {
          A: row.option_a,
          B: row.option_b,
          C: row.option_c,
          D: row.option_d
        }, row.correct.trim());
        results.push({
          id: row.id,
          question: row.question,
          options: shuffled.options,
          correctAnswer: shuffled.correctLetter,
          topic: row.topic
        });
      })
      .on('end', () => {
        questions = results;
        console.log(`Loaded ${questions.length} questions`);
        resolve();
      })
      .on('error', reject);
  });
}

// Create tables on startup if they do not exist
async function initDb() {
  if (!dbEnabled) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_sources (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS emails (
      id BIGSERIAL PRIMARY KEY,
      address TEXT UNIQUE NOT NULL,
      source_id BIGINT REFERENCES email_sources(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_progress (
      id BIGSERIAL PRIMARY KEY,
      email_id BIGINT UNIQUE NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      current_question_index INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      answered INTEGER NOT NULL DEFAULT 0,
      topic_stats JSONB NOT NULL DEFAULT '{}',
      question_order JSONB NOT NULL DEFAULT '[]',
      answer_history JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS intake_events (
      id BIGSERIAL PRIMARY KEY,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      email TEXT,
      source_slug TEXT,
      event TEXT NOT NULL,
      payload JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_emails_address ON emails(address);
    CREATE INDEX IF NOT EXISTS idx_intake_events_email ON intake_events(email);
    CREATE INDEX IF NOT EXISTS idx_intake_events_occurred_at ON intake_events(occurred_at);
  `);
  console.log('Database schema ready');
}

// Save user progress (with source tracking)
app.post('/api/progress/save', async (req, res) => {
  const { email, source_slug, progress } = req.body;

  if (!email || !progress) {
    return res.status(400).json({ error: 'missing email or progress data' });
  }
  if (!dbEnabled) {
    return res.status(503).json({ error: 'progress tracking unavailable' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const slug = source_slug || 'ml-app';

  try {
    const { rows: [source] } = await pool.query(
      `INSERT INTO email_sources (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id`,
      [slug, source_slug || 'ML Training App']
    );

    const { rows: [emailRow] } = await pool.query(
      `INSERT INTO emails (address, source_id) VALUES ($1, $2)
       ON CONFLICT (address) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [cleanEmail, source.id]
    );

    await pool.query(
      `INSERT INTO user_progress
         (email_id, current_question_index, score, answered, topic_stats, question_order, answer_history, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (email_id) DO UPDATE SET
         current_question_index = EXCLUDED.current_question_index,
         score = EXCLUDED.score,
         answered = EXCLUDED.answered,
         topic_stats = EXCLUDED.topic_stats,
         question_order = EXCLUDED.question_order,
         answer_history = EXCLUDED.answer_history,
         updated_at = NOW()`,
      [
        emailRow.id,
        progress.currentQuestionIndex,
        progress.score,
        progress.answered,
        JSON.stringify(progress.topicStats || {}),
        JSON.stringify(progress.questionOrder || []),
        JSON.stringify(progress.answerHistory || {})
      ]
    );

    await pool.query(
      `INSERT INTO intake_events (email, source_slug, event, payload) VALUES ($1, $2, $3, $4)`,
      [cleanEmail, slug, 'progress_save', JSON.stringify({
        currentQuestionIndex: progress.currentQuestionIndex,
        score: progress.score,
        answered: progress.answered
      })]
    );

    return res.json({ success: true, message: 'Progress saved successfully' });
  } catch (err) {
    console.error('Error saving progress:', err);
    return res.status(500).json({ error: 'Failed to save progress' });
  }
});

// Load user progress
app.get('/api/progress/:email', async (req, res) => {
  if (!dbEnabled) return res.json({ exists: false });
  try {
    const cleanEmail = req.params.email.trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT p.* FROM user_progress p
       JOIN emails e ON e.id = p.email_id
       WHERE e.address = $1`,
      [cleanEmail]
    );

    if (rows.length === 0) return res.json({ exists: false });

    const data = rows[0];
    res.json({
      exists: true,
      progress: {
        currentQuestionIndex: data.current_question_index,
        score: data.score,
        answered: data.answered,
        topicStats: data.topic_stats,
        questionOrder: data.question_order,
        answerHistory: data.answer_history || {},
        updatedAt: data.updated_at
      }
    });
  } catch (error) {
    console.error('Error loading progress:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset user progress
app.post('/api/progress/reset', async (req, res) => {
  if (!dbEnabled) return res.json({ success: true, message: 'No progress to reset' });
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const cleanEmail = email.trim().toLowerCase();
    await pool.query(
      `DELETE FROM user_progress WHERE email_id = (SELECT id FROM emails WHERE address = $1)`,
      [cleanEmail]
    );
    res.json({ success: true, message: 'Progress reset successfully' });
  } catch (error) {
    console.error('Error resetting progress:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Donation redirect. Swap providers by changing the DONATE_URL env var
// (e.g. to a Stripe Payment Link); no code change needed.
const DONATE_URL = process.env.DONATE_URL
  || 'https://qr.mobilepay.fi/box/fc157323-1b1a-4061-afd6-cfd06965788d/pay-in';

app.get('/donate', (req, res) => {
  res.redirect(302, DONATE_URL);
});

// Log donation click
app.post('/api/donate/click', async (req, res) => {
  if (!dbEnabled) return res.json({ success: true });
  try {
    const { email } = req.body;
    const cleanEmail = email ? email.trim().toLowerCase() : null;
    await pool.query(
      `INSERT INTO intake_events (email, source_slug, event, payload) VALUES ($1, $2, $3, $4)`,
      [cleanEmail, 'ml-app', 'donate_click', JSON.stringify({ provider: new URL(DONATE_URL).hostname })]
    );
    res.json({ success: true, message: 'Donation click logged' });
  } catch (error) {
    console.error('Error logging donation click:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Questions API
app.get('/api/questions', (req, res) => {
  // Return questions without correct answers
  const questionsWithoutAnswers = questions.map(q => ({
    id: q.id,
    question: q.question,
    options: q.options,
    topic: q.topic
  }));
  res.json(questionsWithoutAnswers);
});

app.get('/api/questions/count', (req, res) => {
  res.json({ count: questions.length });
});

app.post('/api/check-answer', (req, res) => {
  const { questionId, answer } = req.body;
  const question = questions.find(q => q.id === questionId);

  if (!question) {
    return res.status(404).json({ error: 'Question not found' });
  }

  const isCorrect = answer === question.correctAnswer;
  res.json({
    correct: isCorrect,
    correctAnswer: question.correctAnswer,
    topic: question.topic,
    question: question.question
  });
});

app.get('/api/health', async (req, res) => {
  let db = 'disabled';
  if (dbEnabled) {
    try {
      await pool.query('SELECT 1');
      db = 'ok';
    } catch (e) {
      db = 'error';
    }
  }
  res.json({ status: 'ok', questions: questions.length, db });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize server
loadQuestions()
  .then(initDb)
  .catch((err) => {
    // Schema init failure should not take the quiz down
    console.error('Database init failed (progress tracking may not work):', err.message);
  })
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Fatal: could not load questions:', err);
    process.exit(1);
  });
