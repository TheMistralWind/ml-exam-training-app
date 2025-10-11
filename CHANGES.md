# Database Structure Upgrade

## What Changed

The progress tracking system has been upgraded from a simple single-table design to a more sophisticated multi-table structure that supports **attribution tracking** and **event logging**.

## Old Structure (Simple)
```
user_progress
├── id
├── email (unique)
├── current_question_index
├── score
├── answered
├── topic_stats
├── question_order
├── created_at
└── updated_at
```

## New Structure (Advanced)
```
email_sources          emails                  user_progress
├── id                ├── id                  ├── id
├── slug (unique)     ├── address (unique)    ├── email_id → emails.id
├── name              ├── source_id →         ├── current_question_index
└── created_at        │   email_sources.id    ├── score
                      └── created_at          ├── answered
                                              ├── topic_stats
                                              ├── question_order
                                              ├── created_at
                                              └── updated_at

intake_events
├── id
├── email
├── source_slug
├── event
├── payload
└── created_at
```

## Why This Is Better

### 1. **Attribution Tracking**
- Track where each email came from (e.g., "facebook-ad", "google-search", "referral")
- Analyze which marketing channels bring in users
- Calculate ROI for different acquisition sources

### 2. **Centralized Email Management**
- One place to manage all email addresses
- Easy to see which emails have progress saved
- Can be extended for other features (newsletters, notifications, etc.)

### 3. **Event Logging**
- Every progress save is logged in `intake_events`
- Analyze user behavior over time
- Debug issues by reviewing event history
- Build analytics dashboards

### 4. **Data Integrity**
- Foreign key constraints ensure data consistency
- Cascade deletes handle cleanup automatically
- Normalized structure reduces data duplication

## API Changes

The API endpoints remain **backward compatible**. The frontend doesn't need any changes to work, but you can optionally add source tracking:

### Before (still works)
```javascript
await fetch('/api/progress/save', {
    method: 'POST',
    body: JSON.stringify({ email, progress })
});
```

### After (with attribution)
```javascript
await fetch('/api/progress/save', {
    method: 'POST',
    body: JSON.stringify({
        email,
        source_slug: 'facebook-ad', // NEW: optional attribution
        progress
    })
});
```

## Migration Steps

If you already have the old database structure:

### Option 1: Fresh Start (Recommended for testing)
1. Drop old tables in Supabase SQL Editor:
   ```sql
   DROP TABLE IF EXISTS user_progress;
   ```
2. Run the new `supabase-setup.sql` script

### Option 2: Migrate Existing Data
```sql
-- 1. Create new tables (run supabase-setup.sql)

-- 2. Create default source
INSERT INTO email_sources (slug, name) VALUES ('legacy', 'Legacy Users');

-- 3. Migrate emails from old structure
INSERT INTO emails (address, source_id)
SELECT DISTINCT email, (SELECT id FROM email_sources WHERE slug = 'legacy')
FROM user_progress;

-- 4. Update user_progress to use email_id
ALTER TABLE user_progress ADD COLUMN email_id BIGINT;

UPDATE user_progress up
SET email_id = e.id
FROM emails e
WHERE up.email = e.address;

-- 5. Drop old email column
ALTER TABLE user_progress DROP COLUMN email;

-- 6. Add constraints
ALTER TABLE user_progress
    ALTER COLUMN email_id SET NOT NULL,
    ADD CONSTRAINT user_progress_email_id_fkey
        FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE,
    ADD CONSTRAINT user_progress_email_id_key UNIQUE (email_id);
```

## Using Attribution Data

### Query users by source
```sql
SELECT
    es.name as source,
    COUNT(e.id) as total_users,
    COUNT(up.id) as users_with_progress
FROM email_sources es
LEFT JOIN emails e ON e.source_id = es.id
LEFT JOIN user_progress up ON up.email_id = e.id
GROUP BY es.name
ORDER BY total_users DESC;
```

### View recent signup activity
```sql
SELECT
    ie.email,
    ie.source_slug,
    ie.created_at,
    ie.payload->>'score' as score,
    ie.payload->>'answered' as questions_answered
FROM intake_events ie
WHERE ie.event = 'progress_save'
ORDER BY ie.created_at DESC
LIMIT 50;
```

### Track user progress over time
```sql
SELECT
    email,
    DATE(created_at) as date,
    COUNT(*) as saves_per_day,
    MAX((payload->>'answered')::int) as max_questions_answered
FROM intake_events
WHERE event = 'progress_save'
GROUP BY email, DATE(created_at)
ORDER BY date DESC;
```

## Benefits for Your App

1. **Marketing Analytics**: Know which ads/sources convert best
2. **User Behavior**: See patterns in how users engage
3. **Growth Tracking**: Monitor daily signups and completion rates
4. **A/B Testing**: Compare different sources or campaigns
5. **Retargeting**: Identify users who started but didn't finish

## Notes

- All changes are backward compatible
- Frontend works without any modifications
- Source tracking is optional (defaults to "default")
- Event logging happens automatically
- All queries respect Row Level Security policies
