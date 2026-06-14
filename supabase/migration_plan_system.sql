-- SQL Migration for ReplyGenius AI Plan System & Chat logs

-- 1. Create Plans Table
CREATE TABLE IF NOT EXISTS public.plans (
    id TEXT PRIMARY KEY, -- 'free', 'premium', or custom identifiers
    name TEXT NOT NULL,
    price NUMERIC NOT NULL DEFAULT 0,
    offer_price NUMERIC, -- Discounted price (null if no offer)
    billing_period TEXT DEFAULT 'monthly', -- 'monthly', 'yearly', 'one-time'
    daily_limit INT DEFAULT 10, -- -1 means unlimited
    allow_screenshots BOOLEAN DEFAULT false,
    allow_premium_styles BOOLEAN DEFAULT false,
    status TEXT DEFAULT 'active', -- 'active' or 'inactive'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Seed Initial Plans
INSERT INTO public.plans (id, name, price, offer_price, billing_period, daily_limit, allow_screenshots, allow_premium_styles, status) VALUES
('free', 'Free Plan', 0.00, NULL, 'monthly', 10, false, false, 'active'),
('premium', 'Premium Plan', 199.00, 99.00, 'monthly', -1, true, true, 'active')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    offer_price = EXCLUDED.offer_price,
    daily_limit = EXCLUDED.daily_limit,
    allow_screenshots = EXCLUDED.allow_screenshots,
    allow_premium_styles = EXCLUDED.allow_premium_styles;

-- 2. Alter Users Table to reference Plans
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS plan_id TEXT DEFAULT 'free' REFERENCES public.plans(id) ON DELETE SET DEFAULT;

-- 3. Create Messages Table for Chat Logs
CREATE TABLE IF NOT EXISTS public.messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES public.users(id) ON DELETE CASCADE,
    sender TEXT NOT NULL, -- 'user' or 'bot'
    content TEXT,
    metadata JSONB DEFAULT '{}'::jsonb, -- Store image_url, chosen_style, etc.
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for fast user chat logs loading
CREATE INDEX IF NOT EXISTS idx_messages_user_timestamp ON public.messages(user_id, timestamp);

-- 4. Enable Row Level Security (RLS) on new tables
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 5. Seed new settings
INSERT INTO public.settings (key, value) VALUES
('telegram_log_channel_id', ''),
('free_tier_daily_limit', '10')
ON CONFLICT (key) DO NOTHING;

-- 6. Setup Supabase Storage Bucket for Screenshots
-- Insert bucket definition
INSERT INTO storage.buckets (id, name, public)
VALUES ('screenshots', 'screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- Add RLS Policies to Storage Bucket objects
DROP POLICY IF EXISTS "Allow public read access to screenshots" ON storage.objects;
CREATE POLICY "Allow public read access to screenshots" ON storage.objects
    FOR SELECT TO public USING (bucket_id = 'screenshots');

DROP POLICY IF EXISTS "Allow service role uploads to screenshots" ON storage.objects;
CREATE POLICY "Allow service role uploads to screenshots" ON storage.objects
    FOR INSERT TO service_role WITH CHECK (bucket_id = 'screenshots');
