# ML Exam Training App

A web-based quiz application for machine learning exam preparation with 120 multiple-choice questions.

## Features

- 120 ML exam questions organized by topic
- **Random question order** - Questions shuffled for each session
- **Email signup after 5 questions** - Save progress and continue later
- **Progress tracking** - Resume from where you left off
- Instant feedback on answers
- Google search suggestions for incorrect answers
- Topic-based performance breakdown
- Final score with performance evaluation
- Mobile-responsive design

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Database**: Supabase (PostgreSQL)
- **CSV Parsing**: csv-parser

## Installation

1. Install dependencies:
```bash
npm install
```

2. **Set up Supabase** (required for progress tracking):
   - See [SETUP.md](./SETUP.md) for detailed instructions
   - Create a Supabase project
   - Run the SQL script from `supabase-setup.sql`
   - Copy your credentials to `.env`

3. Run the application:
```bash
npm start
```

4. Open your browser and navigate to `http://localhost:3000`

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

**Questions**
- `GET /api/questions` - Fetch all questions (without answers)
- `GET /api/questions/count` - Get total question count
- `POST /api/check-answer` - Verify an answer

**Progress Tracking**
- `POST /api/progress/save` - Save user progress
- `GET /api/progress/:email` - Load user progress by email
- `POST /api/progress/reset` - Reset user progress

## Usage

1. Start the quiz by clicking on an answer option
2. Get instant feedback on each answer
3. For wrong answers, click the search link to learn more
4. After 5 questions, you'll be prompted to enter your email
5. Your progress is automatically saved to continue later
6. When you return, choose to **Continue** or **Start Fresh**
7. Complete all 120 questions to view your final score and topic breakdown

## How Progress Tracking Works

- After answering 5 questions, a modal prompts you to save your progress with email
- Progress is stored both locally (localStorage) and remotely (Supabase)
- When you return, you'll see a "Welcome Back" screen with options to:
  - **Continue**: Resume from your exact spot with same question order
  - **Start Fresh**: Clear progress and get new random question order
- Click "Start Over" at results screen to reset and try again

## License

MIT
