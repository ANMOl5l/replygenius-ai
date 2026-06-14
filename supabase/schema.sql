-- Database Schema for ReplyGenius AI
-- Host: Supabase PostgreSQL

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS public.users (
    id BIGINT PRIMARY KEY, -- Telegram User ID
    username TEXT,
    language TEXT DEFAULT 'en',
    status TEXT DEFAULT 'active', -- 'active' or 'banned'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users(status);

-- 2. Preferences Table
CREATE TABLE IF NOT EXISTS public.preferences (
    user_id BIGINT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    reply_style TEXT DEFAULT 'Casual', -- 'Casual', 'Funny', 'Flirty', 'Confident'
    language TEXT DEFAULT 'English',
    personality TEXT DEFAULT 'Natural'
);

-- 3. Memory Table
CREATE TABLE IF NOT EXISTS public.memory (
    user_id BIGINT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    summary TEXT DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Usage Logs Table
CREATE TABLE IF NOT EXISTS public.usage_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES public.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL, -- 'reply_generation', 'screenshot_analysis', 'rewrite'
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_timestamp ON public.usage_logs(user_id, timestamp);

-- 5. API Configs Table
CREATE TABLE IF NOT EXISTS public.api_configs (
    provider TEXT PRIMARY KEY, -- 'openrouter', 'openai', 'gemini', 'claude', 'groq'
    api_key TEXT, -- Encrypted AES-GCM base64 format
    status TEXT DEFAULT 'inactive', -- 'active', 'inactive'
    model_name TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Settings Table
CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 7. Backups Table
CREATE TABLE IF NOT EXISTS public.backups (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    filename TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS (Row Level Security) on all tables to secure them.
-- Since the bot and admin panel will use the service_role key to bypass RLS,
-- we deny all public access by default.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

-- Seed initial API Configurations
INSERT INTO public.api_configs (provider, api_key, status, model_name) VALUES
('openrouter', NULL, 'inactive', 'google/gemini-2.5-flash'),
('openai', NULL, 'inactive', 'gpt-4o-mini'),
('gemini', NULL, 'inactive', 'gemini-1.5-flash'),
('claude', NULL, 'inactive', 'claude-3-5-sonnet-latest'),
('groq', NULL, 'inactive', 'llama-3.3-70b-versatile')
ON CONFLICT (provider) DO NOTHING;

-- Seed system prompts and settings
INSERT INTO public.settings (key, value) VALUES
('telegram_bot_token', ''), -- Encrypted
('telegram_webhook_url', ''),
('maintenance_mode', 'false'),
('prompt_system_core', 'You are ReplyGenius AI, a text message assistant that generates realistic, highly human-sounding, and conversational chat replies. Avoid AI typical phrasing like "Sure!", "Here is a reply:", or "I can help with that." Do not use corporate speak, over-explanations, or markdown formatting list structures in the outputs. Write only direct reply texts.'),
('prompt_style_casual', 'Generate a short, natural, laid-back text reply. Use casual slang, lowercases where appropriate, and keep it very conversational (e.g. "sure down", "already did that").'),
('prompt_style_funny', 'Generate a witty, lighthearted, or sarcastic text reply. Use light emojis (e.g. 😭,💀) if fitting. Keep it short and funny.'),
('prompt_style_flirty', 'Generate a playful, flirty, or teasing text reply. Keep it subtle and attractive (e.g. using 😏 or 😉). Not overly sexual, just charm.'),
('prompt_style_confident', 'Generate a direct, clear, and confident text reply. Assured tone, short and sweet, no hesitation.')
ON CONFLICT (key) DO NOTHING;
