# ML Exam Training App

A web-based quiz application for machine learning exam preparation with 120 multiple-choice questions.

## Features

- Question bank: `questions.csv` (120, reviewed July 2026 against the 2025 lecture slides) plus `data/questions-2.csv` (60 added October 2026 from the 2023 slides of lectures 3 to 6, aimed at the topics students miss most). Same columns; ids continue upward. Any `data/questions-N.csv` is loaded.
- Rounds of ten with a summary after each: score, topics, and every missed question with the right option and why.
- An explanation under every answer, right or wrong: `data/explanations.json` and `data/explanations-2.json`, one or two sentences per question id, sent only after an answer is checked.
- Practice decks beside the main run, which never change its score: the questions missed so far (a question stays until it is answered right), or one topic, from a picker that lists topics weakest first.
- Progress is kept in the browser without an account and restores on the next visit. Adding an email on a round summary saves it to the server so it follows the student to another device (the "Sign in" button loads it).
- Random question order per student, deterministic option order per question (see Tech Stack).
- Share button on the round summary, MobilePay donation link, PostHog events for every step.

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Database**: PostgreSQL (Railway)
- **Analytics**: PostHog

## Installation

1. Install dependencies:
```bash
npm install
```

2. **Set up the database** (required for progress tracking):
   - Copy `.env.example` to `.env` and set `DATABASE_URL` to any Postgres instance
   - The server creates its own tables at startup
   - Without `DATABASE_URL` the quiz still works; only progress saving is disabled

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
├── questions.csv                      # Questions database
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
- Progress is stored both locally (localStorage) and remotely (Postgres)
- When you return, you'll see a "Welcome Back" screen with options to:
  - **Continue**: Resume from your exact spot with same question order
  - **Start Fresh**: Clear progress and get new random question order
- Click "Start Over" at results screen to reset and try again

## License

MIT

## Staging

Railway environment `staging` in the "ML exam app" project (created 2026-10-13), with its own empty Postgres. It serves https://ml-exam-training-app-staging.up.railway.app and is deployed from whatever commit is sent to it; production stays on `main`. The API token in Bitwarden cannot change the service's source branch (`serviceInstanceUpdate` fails) but can deploy a commit: `serviceInstanceDeployV2(serviceId, environmentId, commitSha)`. Nothing in staging is linked from the website.
