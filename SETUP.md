# Email Signup & Progress Tracking Setup

## Overview
This feature allows users to:
- Answer 5 questions as a "trial"
- Get prompted to sign up with their email
- Save their progress to continue later
- Choose to continue from where they left off or start fresh

## Setup Instructions

### 1. Set up Supabase

1. Go to [Supabase](https://app.supabase.com) and create a new project (or use your existing one)
2. Wait for the project to finish setting up
3. Navigate to the **SQL Editor** in your Supabase dashboard
4. Copy and paste the contents of `supabase-setup.sql` into the SQL Editor
5. Click "Run" to create the `user_progress` table

### 2. Get your Supabase credentials

1. In your Supabase dashboard, go to **Project Settings** > **API**
2. Copy your:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon/public key** (the long string under "Project API keys")

### 3. Configure environment variables

1. Create a `.env` file in the root directory:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and add your Supabase credentials:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your_anon_key_here
   PORT=3000
   ```

### 4. Start the application

```bash
npm start
```

## How it Works

### User Flow

1. **First Visit**
   - User starts answering questions
   - Questions are shuffled randomly
   - Progress is saved to localStorage temporarily

2. **After 5 Questions**
   - A modal appears asking for their email
   - User enters email and submits
   - Progress is saved to Supabase
   - User can continue answering questions

3. **Returning Visit**
   - If user has saved progress, they see a "Welcome Back" modal
   - Two options:
     - **Continue**: Restore their exact progress (question order, score, stats)
     - **Start Fresh**: Clear progress and start from beginning with new random order

4. **Completing the Quiz**
   - User sees final results
   - Can click "Start Over" to reset progress and try again

### Technical Details

**Backend (server.js)**
- Three new API endpoints:
  - `POST /api/progress/save` - Save user progress
  - `GET /api/progress/:email` - Load user progress
  - `POST /api/progress/reset` - Reset user progress

**Frontend (app.js)**
- Progress tracking after each answer
- LocalStorage for temporary storage
- Automatic save to Supabase when user has email
- Modal management for signup and welcome back flows

**Database Schema**

The system uses 4 tables for better organization and attribution tracking:

1. **`email_sources`** - Tracks where emails came from
   - `slug` (unique identifier, e.g., "default", "facebook-ad")
   - `name` (display name)

2. **`emails`** - Central email registry
   - `address` (unique email address)
   - `source_id` (links to email_sources)

3. **`user_progress`** - Stores quiz progress
   - `email_id` (links to emails table)
   - `current_question_index` (where they left off)
   - `score` (correct answers)
   - `answered` (total answered)
   - `topic_stats` (performance by topic)
   - `question_order` (their randomized question order)
   - `updated_at` (last save time)

4. **`intake_events`** - Logs all progress save events
   - `email` (user's email)
   - `source_slug` (attribution)
   - `event` (e.g., "progress_save")
   - `payload` (event data)

This structure allows you to:
- Track where your users come from (attribution)
- Maintain a clean email list
- Log all user interactions for analytics
- Easily query user behavior over time

## Customization

### Change signup trigger
In `app.js`, modify line 151:
```javascript
if (!userEmail && answered === 5 && !hasShownSignup) {
```
Change `5` to any number of questions.

### Track email sources (attribution)
The API now supports `source_slug` for tracking where users come from. To use this:

1. **In your frontend** (app.js), modify the `saveProgress` function to include source:
   ```javascript
   const response = await fetch('/api/progress/save', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
           email,
           source_slug: 'facebook-ad', // or get from URL parameter
           progress
       })
   });
   ```

2. **Get source from URL**: Add this to your app.js initialization:
   ```javascript
   // Get source from URL parameter (e.g., ?source=facebook-ad)
   const urlParams = new URLSearchParams(window.location.search);
   const sourceSlug = urlParams.get('source') || 'default';
   localStorage.setItem('source_slug', sourceSlug);
   ```

3. **Use it when saving**:
   ```javascript
   const sourceSlug = localStorage.getItem('source_slug') || 'default';
   await saveProgress(email, sourceSlug);
   ```

Then you can track which sources bring in users by querying:
```sql
SELECT es.name, COUNT(DISTINCT e.id) as user_count
FROM email_sources es
JOIN emails e ON e.source_id = es.id
GROUP BY es.name;
```

### Disable signup requirement
To make signup optional but still available, you could add a "Skip" button to the signup modal.

### Add email validation
You can enhance the email validation in the signup form or add email verification through Supabase Auth.

## Security Notes

- Email addresses are stored in lowercase for consistency
- The current setup uses Supabase's anon key (suitable for client-side access)
- For production, consider:
  - Adding Supabase Auth for proper user authentication
  - Implementing rate limiting on the API endpoints
  - Adding email verification
  - Setting up proper Row Level Security policies in Supabase

## Troubleshooting

**Modal doesn't appear after 5 questions**
- Check browser console for errors
- Verify the signup trigger logic in `app.js`
- Ensure the modal elements exist in `index.html`

**Progress not saving**
- Verify `.env` file has correct Supabase credentials
- Check that the `user_progress` table exists in Supabase
- Check browser console and server logs for errors

**Progress not loading on return**
- Check that email is stored in localStorage
- Verify API endpoint `/api/progress/:email` returns data
- Check browser console for errors

**Questions in wrong order on resume**
- The app saves the question order and restores it exactly
- If questions changed on the server, old question IDs may not match
