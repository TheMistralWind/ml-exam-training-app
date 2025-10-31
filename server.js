require('dotenv').config();
console.log('✓ Environment variables loaded');

const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
console.log('✓ All modules loaded');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase client (prefer service role if present)
console.log('Initializing Supabase client...');
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);
console.log('✓ Supabase client initialized');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
console.log('✓ Express middleware configured');

let questions = [];

// Load questions from CSV
function loadQuestions() {
  console.log('Loading questions from CSV...');
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(path.join(__dirname, 'ML 120 questions for app.csv'))
      .pipe(csv())
      .on('data', (data) => {
        // Push raw; we'll sanitize with cross-question pools in the end phase
        results.push({
          id: data['Question ID'],
          question: data['Question'],
          options: {
            A: data['Option A'],
            B: data['Option B'],
            C: data['Option C (Correct)'],
            D: data['Option D']
          },
          correctAnswer: (data['Correct Answer'] || '').trim(),
          topic: data['Topic']
        });
      })
      .on('end', () => {
        // Build per-topic distractor pools from all other questions' incorrect options
        const topicToPool = new Map();
        for (const q of results) {
          const pool = topicToPool.get(q.topic) || new Set();
          const correctLetter = q.correctAnswer || 'C';
          const correctText = q.options[correctLetter] || q.options.C;
          for (const key of ['A', 'B', 'C', 'D']) {
            if (key === correctLetter) continue;
            const opt = q.options[key];
            if (!opt) continue;
            const trimmed = String(opt).trim();
            if (!trimmed) continue;
            if (trimmed === correctText) continue;
            pool.add(trimmed);
          }
          topicToPool.set(q.topic, pool);
        }

        // Fallback generic distractors
        const fallbackDistractors = [
          'None of the above.',
          'All of the above.',
          'It depends on the specific dataset and setup.',
          'Increase model complexity regardless of overfitting risk.',
          'Reduce dimensionality without considering variance.'
        ];

        // Sanitize each question using its topic pool, avoiding duplicates within the question
        questions = results.map((q) => {
          const correctLetter = q.correctAnswer || 'C';
          const correctText = q.options[correctLetter] || q.options.C;
          const used = new Set();
          const sanitized = { ...q.options };
          // Mark initially used values
          for (const key of ['A', 'B', 'C', 'D']) {
            if (sanitized[key]) used.add(sanitized[key]);
          }
          const topicPool = Array.from(topicToPool.get(q.topic) || []);

          function pickReplacement() {
            // Prefer topic pool items not used yet
            let rep = topicPool.find(v => v !== correctText && !used.has(v));
            if (!rep) {
              rep = fallbackDistractors.find(v => v !== correctText && !used.has(v)) || 'None of the above.';
            }
            used.add(rep);
            return rep;
          }

          for (const key of ['A', 'B', 'C', 'D']) {
            if (key === correctLetter) continue;
            const val = sanitized[key];
            if (!val || String(val).trim() === '' || val === correctText) {
              sanitized[key] = pickReplacement();
            }
          }

        return {
            id: q.id,
            question: q.question,
            options: sanitized,
            correctAnswer: correctLetter,
            topic: q.topic
          };
        });
        console.log(`✓ Loaded ${questions.length} questions`);
        resolve();
      })
      .on('error', (err) => {
        console.error('✗ Error loading questions:', err);
        reject(err);
      });
  });
}

// Progress Management API Routes

// Save user progress (with source tracking)
app.post("/api/progress/save", async (req, res) => {
  const { email, source_slug, progress } = req.body;

  if (!email || !progress) {
    return res.status(400).json({ error: "missing email or progress data" });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    // 1️⃣ ensure the source exists (for attribution)
    const { data: source, error: srcErr } = await supabase
      .from("email_sources")
      .upsert({ slug: source_slug || "ml-app", name: source_slug || "ML Training App" }, { onConflict: "slug" })
      .select("id")
      .single();

    if (srcErr) {
      console.error('Supabase error (email_sources upsert):', srcErr);
      throw srcErr;
    }

    // 2️⃣ upsert email (case-insensitive)
    const { data: emailRow, error: emailErr } = await supabase
      .from("emails")
      .upsert({ address: cleanEmail, source_id: source.id }, { onConflict: "address" })
      .select("id")
      .single();

    if (emailErr) {
      console.error('Supabase error (emails upsert):', emailErr);
      throw emailErr;
    }

    // 3️⃣ upsert progress linked by email_id
    const { error: progressErr } = await supabase.from("user_progress").upsert({
      email_id: emailRow.id,
      current_question_index: progress.currentQuestionIndex,
      score: progress.score,
      answered: progress.answered,
      topic_stats: progress.topicStats,
      question_order: progress.questionOrder,
      answer_history: progress.answerHistory || {},
      updated_at: new Date().toISOString()
    }, { onConflict: "email_id" });

    if (progressErr) {
      console.error('Supabase error (user_progress upsert):', progressErr);
      throw progressErr;
    }

    // 4️⃣ optional: log the event
    const { error: eventsErr } = await supabase.from("intake_events").insert({
      email: cleanEmail,
      source_slug: source_slug || "ml-app",
      event: "progress_save",
      payload: progress
    });
    if (eventsErr) {
      console.error('Supabase error (intake_events insert):', eventsErr);
      throw eventsErr;
    }

    return res.json({ success: true, message: "Progress saved successfully" });
  } catch (err) {
    console.error("Error saving progress:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Load user progress
app.get('/api/progress/:email', async (req, res) => {
  try {
    const cleanEmail = req.params.email.trim().toLowerCase();

    // First, get the email_id
    const { data: emailRow, error: emailErr } = await supabase
      .from('emails')
      .select('id')
      .eq('address', cleanEmail)
      .single();

    if (emailErr || !emailRow) {
      // No email found, no progress
      return res.json({ exists: false });
    }

    // Now get the progress
    const { data, error } = await supabase
      .from('user_progress')
      .select('*')
      .eq('email_id', emailRow.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No progress found
        return res.json({ exists: false });
      }
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to load progress' });
    }

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
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // First, get the email_id
    const { data: emailRow, error: emailErr } = await supabase
      .from('emails')
      .select('id')
      .eq('address', cleanEmail)
      .single();

    if (emailErr || !emailRow) {
      // No email found, nothing to reset
      return res.json({ success: true, message: 'No progress to reset' });
    }

    // Delete the progress
    const { error } = await supabase
      .from('user_progress')
      .delete()
      .eq('email_id', emailRow.id);

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to reset progress' });
    }

    res.json({ success: true, message: 'Progress reset successfully' });
  } catch (error) {
    console.error('Error resetting progress:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Log donation click
app.post('/api/donate/click', async (req, res) => {
  try {
    const { email } = req.body;
    const cleanEmail = email ? email.trim().toLowerCase() : null;

    // Log donation click event
    const { error } = await supabase.from('intake_events').insert({
      email: cleanEmail,
      source_slug: 'ml-app', // Default source for donation clicks
      event: 'donate_click',
      payload: { provider: 'mobilepay' }
    });

    if (error) {
      console.error('Supabase error (donate_click):', error);
      return res.status(500).json({ error: 'Failed to log donation click' });
    }

    res.json({ success: true, message: 'Donation click logged' });
  } catch (error) {
    console.error('Error logging donation click:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API Routes
app.get('/api/questions', (req, res) => {
  // Return questions without correct answers (for security)
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

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize server
loadQuestions().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Error loading questions:', err);
  process.exit(1);
});
