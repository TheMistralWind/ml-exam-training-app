# AGENTS.md — ml-exam-training-app

Canonical context for AI coding agents. (Claude Code reads `CLAUDE.md`, which imports this.)

## Project
A trainer for the Aalto University machine-learning exam: a question bank the user drills against. Has had hundreds of real users. Node + Express server with a Supabase backend.

## Stack
- Node, Express. Entry: `server.js` (no build step). Backend: Supabase (`supabase-setup.sql` for schema). PostHog analytics.
- Question content: `ML 120 questions for app.csv`. Frontend assets in `public/`.

## Commands
- Install: `npm install`
- Run: `npm start` (= `node server.js`). Dev: `npm run dev` (same).
- Env: copy `.env.example` → `.env` and fill Supabase keys (URL + anon/service keys).

## Deploy
- Railway, production service `ml-exam-training-app-production`. Push to `main` → production. The website's "ML Exam Trainer" card links to the production URL.

## Conventions (IMPORTANT)
- **Secrets live only in `.env`** (gitignored). NEVER commit Supabase keys; `.env.example` is the template.
- Keep PostHog analytics wiring intact.
- **NEVER use em dashes.**

## Do-not
- Never commit `.env` or Supabase credentials. No em dashes. Don't commit `node_modules/`.
