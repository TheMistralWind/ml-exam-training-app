# ML Exam Training App

A web-based quiz application for machine learning exam preparation with 120 multiple-choice questions.

## Features

- 120 ML exam questions organized by topic
- Sequential question flow
- Instant feedback on answers
- AI search suggestions for incorrect answers
- Topic-based performance breakdown
- Final score with performance evaluation
- Mobile-responsive design

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **CSV Parsing**: csv-parser

## Installation

1. Install dependencies:
```bash
npm install
```

2. Run the application:
```bash
npm start
```

3. Open your browser and navigate to `http://localhost:3000`

## Deployment to Railway

1. Push your code to GitHub
2. Go to [Railway](https://railway.app/)
3. Create a new project
4. Connect your GitHub repository
5. Railway will automatically detect the Node.js app and deploy it
6. Your app will be live at the provided Railway URL

## Project Structure

```
.
├── server.js                          # Express server
├── package.json                       # Dependencies
├── ML 120 questions for app.csv       # Questions database
├── public/
│   ├── index.html                     # Main HTML file
│   ├── styles.css                     # Styling
│   └── app.js                         # Frontend logic
└── README.md
```

## API Endpoints

- `GET /api/questions` - Fetch all questions (without answers)
- `GET /api/questions/count` - Get total question count
- `POST /api/check-answer` - Verify an answer

## Usage

1. Start the quiz by clicking on an answer option
2. Get instant feedback
3. For wrong answers, click the search link to learn more
4. Progress through all 120 questions
5. View your final score and topic breakdown

## License

MIT
