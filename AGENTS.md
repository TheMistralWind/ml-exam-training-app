# AGENTS.md — ml-exam-training-app

Canonical context for AI coding agents. (Claude Code reads `CLAUDE.md`, which imports this.)

## Project
A trainer for the Aalto University machine-learning exam: a question bank the user drills against. Has had hundreds of real users. Node + Express server with Postgres on Railway (migrated off Supabase in July 2026).

## Stack
- Node, Express, `pg`. Entry: `server.js` (no build step). The server creates its own schema at startup (`initDb` in `server.js`). PostHog analytics (custom events via `track()` in `public/app.js`).
- Question content: `questions.csv` (columns: id, question, option_a..option_d, correct, topic). Option order is shuffled deterministically per question id so answer letters stay stable across deploys. Frontend assets in `public/`.

## Commands
- Install: `npm install`
- Run: `npm start` (= `node server.js`). Dev: `npm run dev` (same).
- Env: copy `.env.example` to `.env` and set `DATABASE_URL`. Without it the quiz still works; progress saving is disabled.

## Deploy
- Railway project "ML exam app": service `ml-exam-training-app` plus service `postgres` (volume-backed). Push to `main` deploys production. The app reaches Postgres via the private network URL; `DATABASE_SSL` stays unset there. The website's "ML Exam Trainer" card links to the production URL.

## Conventions (IMPORTANT)
- **Secrets live only in `.env`** (gitignored) and Railway variables. `.env.example` is the template.
- Keep PostHog analytics wiring intact (`public/index.html` snippet + `track()`/`identifyUser()` helpers).
- **NEVER use em dashes.**

## Do-not
- Never commit `.env` or database credentials. No em dashes. Don't commit `node_modules/`.
