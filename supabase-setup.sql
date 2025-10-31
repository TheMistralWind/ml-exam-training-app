-- SQL script to create all required tables in Supabase
-- Run this in your Supabase SQL Editor

-- 1️⃣ Email Sources Table (for attribution tracking)
CREATE TABLE IF NOT EXISTS email_sources (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2️⃣ Emails Table (central email registry)
CREATE TABLE IF NOT EXISTS emails (
    id BIGSERIAL PRIMARY KEY,
    address TEXT UNIQUE NOT NULL,
    source_id BIGINT REFERENCES email_sources(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3️⃣ User Progress Table (linked to emails)
CREATE TABLE IF NOT EXISTS user_progress (
    id BIGSERIAL PRIMARY KEY,
    email_id BIGINT UNIQUE NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    current_question_index INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    answered INTEGER NOT NULL DEFAULT 0,
    topic_stats JSONB NOT NULL DEFAULT '{}',
    question_order JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4️⃣ Intake Events Table (for event logging)
CREATE TABLE IF NOT EXISTS intake_events (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    source_slug TEXT,
    event TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_email_sources_slug ON email_sources(slug);
CREATE INDEX IF NOT EXISTS idx_emails_address ON emails(address);
CREATE INDEX IF NOT EXISTS idx_user_progress_email_id ON user_progress(email_id);
CREATE INDEX IF NOT EXISTS idx_intake_events_email ON intake_events(email);
CREATE INDEX IF NOT EXISTS idx_intake_events_source_slug ON intake_events(source_slug);
CREATE INDEX IF NOT EXISTS idx_intake_events_created_at ON intake_events(created_at);

-- Enable Row Level Security (RLS) - optional but recommended
ALTER TABLE email_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_events ENABLE ROW LEVEL SECURITY;

-- Create policies that allow public access
-- Note: In a production app, you'd want proper authentication
-- For now, this allows any user with the anon key to access data

CREATE POLICY "Allow public access" ON email_sources
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow public access" ON emails
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow public access" ON user_progress
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow public access" ON intake_events
    FOR ALL
    USING (true)
    WITH CHECK (true);
