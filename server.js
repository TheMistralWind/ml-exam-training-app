const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let questions = [];

// Load questions from CSV
function loadQuestions() {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(path.join(__dirname, 'ML 120 questions for app.csv'))
      .pipe(csv())
      .on('data', (data) => {
        results.push({
          id: data['Question ID'],
          question: data['Question'],
          options: {
            A: data['Option A'],
            B: data['Option B'],
            C: data['Option C (Correct)'],
            D: data['Option D']
          },
          correctAnswer: data['Correct Answer'],
          topic: data['Topic']
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
