-- Influencer Discovery Dashboard Schema
-- Run this against your Supabase/Postgres database

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Core creator profile
CREATE TABLE creators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  website TEXT,
  public_email TEXT,
  public_phone TEXT,
  total_followers BIGINT DEFAULT 0,
  has_course BOOLEAN DEFAULT FALSE,
  has_discord BOOLEAN DEFAULT FALSE,
  has_telegram BOOLEAN DEFAULT FALSE,
  promoting_prop_firms BOOLEAN DEFAULT FALSE,
  prop_firms_mentioned TEXT[] DEFAULT '{}',
  instagram_url TEXT,
  linkedin_url TEXT,
  youtube_url TEXT,
  x_url TEXT,
  link_in_bio_url TEXT,
  course_url TEXT,
  contact_form_url TEXT,
  discord_url TEXT,
  telegram_url TEXT,
  has_skool BOOLEAN DEFAULT FALSE,
  has_whop BOOLEAN DEFAULT FALSE,
  niche TEXT,
  primary_platform TEXT,
  source_type TEXT,
  source_url TEXT,
  is_prop_firm BOOLEAN DEFAULT FALSE,
  excluded_from_leads BOOLEAN DEFAULT FALSE,
  lead_score REAL DEFAULT 0,
  confidence_score REAL DEFAULT 0,
  notes TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'replied', 'qualified', 'rejected', 'converted')),
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Social accounts linked to a creator
CREATE TABLE creator_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'x', 'instagram', 'tiktok', 'twitch', 'discord', 'telegram', 'linkedin')),
  handle TEXT NOT NULL,
  profile_url TEXT,
  followers BIGINT DEFAULT 0,
  platform_id TEXT,
  bio TEXT,
  verified BOOLEAN DEFAULT FALSE,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, handle)
);

-- Tracked posts / content
CREATE TABLE creator_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  account_id UUID REFERENCES creator_accounts(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  post_url TEXT,
  title TEXT,
  content_snippet TEXT,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  published_at TIMESTAMPTZ,
  mentions_prop_firm BOOLEAN DEFAULT FALSE,
  mentions_course BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily discovery runs
CREATE TABLE daily_discoveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  platform TEXT NOT NULL,
  new_creators_found INT DEFAULT 0,
  existing_creators_updated INT DEFAULT 0,
  errors TEXT[] DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed'))
);

-- Keyword-yield analytics: tracks per-keyword discovery performance
-- across refreshes so the pipeline can prioritize high-yield keywords.
CREATE TABLE IF NOT EXISTS keyword_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform TEXT NOT NULL,
  keyword TEXT NOT NULL,
  category TEXT,
  total_runs INT DEFAULT 0,
  total_candidates INT DEFAULT 0,
  total_known_skipped INT DEFAULT 0,
  total_inserted INT DEFAULT 0,
  total_with_email INT DEFAULT 0,
  total_duplicates INT DEFAULT 0,
  total_rejected INT DEFAULT 0,
  performance_score REAL DEFAULT 50.0,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, keyword)
);

CREATE INDEX IF NOT EXISTS idx_kp_platform_score
  ON keyword_performance(platform, performance_score DESC);

-- Outreach tracking
CREATE TABLE outreach (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'dm', 'form', 'other')),
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'sent', 'opened', 'replied', 'bounced')),
  response TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_creators_lead_score ON creators(lead_score DESC);
CREATE INDEX idx_creators_status ON creators(status);
CREATE INDEX idx_creators_first_seen ON creators(first_seen_at DESC);
CREATE INDEX idx_creators_last_seen ON creators(last_seen_at DESC);
CREATE INDEX idx_creator_accounts_platform ON creator_accounts(platform);
CREATE INDEX idx_creator_accounts_creator ON creator_accounts(creator_id);
CREATE INDEX idx_creator_accounts_platform_id ON creator_accounts(platform, platform_id);
CREATE INDEX idx_creator_posts_creator ON creator_posts(creator_id);
CREATE INDEX idx_creator_posts_url ON creator_posts(post_url);
CREATE INDEX idx_daily_discoveries_date ON daily_discoveries(run_date DESC);
CREATE INDEX idx_outreach_creator ON outreach(creator_id);
CREATE INDEX idx_outreach_status ON outreach(status);

-- ═══════════════════════════════════════════════════════════════════
-- Migration: Performance indexes for duplicate exclusion at scale
-- Run these on Supabase SQL Editor. All use IF NOT EXISTS — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- CRITICAL: excluded_from_leads is filtered on EVERY Daily Leads query
-- Without this, every page load scans all rows
CREATE INDEX IF NOT EXISTS idx_creators_excluded ON creators(excluded_from_leads);

-- CRITICAL: email-based dedup + "has email" filter
-- Partial index: only indexes non-null emails (saves space)
CREATE INDEX IF NOT EXISTS idx_creators_email ON creators(public_email) WHERE public_email IS NOT NULL;

-- CRITICAL: website-based dedup + "has website" filter
CREATE INDEX IF NOT EXISTS idx_creators_website_notnull ON creators(website) WHERE website IS NOT NULL;

-- Daily Leads page filtering
CREATE INDEX IF NOT EXISTS idx_creators_confidence ON creators(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_creators_followers ON creators(total_followers DESC);
CREATE INDEX IF NOT EXISTS idx_creators_phone ON creators(public_phone) WHERE public_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creators_contact_form ON creators(contact_form_url) WHERE contact_form_url IS NOT NULL;

-- Case-insensitive handle dedup (avoids .ilike() full scans)
CREATE INDEX IF NOT EXISTS idx_accounts_handle_lower ON creator_accounts(platform, LOWER(handle));

-- Prop-firm backfill composite
CREATE INDEX IF NOT EXISTS idx_creators_prop_status ON creators(excluded_from_leads, is_prop_firm);

-- DB-level email uniqueness safety net (prevents race-condition duplicates)
-- Partial + case-insensitive: NULLs don't conflict, case variations are caught.
-- If this fails because duplicates already exist, run the dedup query below first:
--
--   DELETE FROM creators WHERE id IN (
--     SELECT id FROM (
--       SELECT id, ROW_NUMBER() OVER (
--         PARTITION BY LOWER(public_email) ORDER BY lead_score DESC, created_at ASC
--       ) AS rn FROM creators WHERE public_email IS NOT NULL
--     ) sub WHERE rn > 1
--   );
--
CREATE UNIQUE INDEX IF NOT EXISTS idx_creators_email_unique
  ON creators(LOWER(public_email)) WHERE public_email IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════

-- Migration helper: add columns to existing table if upgrading
-- ALTER TABLE creators ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT NOW();
-- ALTER TABLE creators ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();
-- CREATE INDEX IF NOT EXISTS idx_creators_first_seen ON creators(first_seen_at DESC);
-- CREATE INDEX IF NOT EXISTS idx_creators_last_seen ON creators(last_seen_at DESC);
-- CREATE INDEX IF NOT EXISTS idx_creator_accounts_platform_id ON creator_accounts(platform, platform_id);
-- CREATE INDEX IF NOT EXISTS idx_creator_posts_url ON creator_posts(post_url);
-- ALTER TABLE creators ADD COLUMN IF NOT EXISTS instagram_url TEXT;
-- ALTER TABLE creators ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
