-- SQL Migration for Multi-Key Rotation & Failover System

-- 1. Create API Keys Table
CREATE TABLE IF NOT EXISTS public.api_keys (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider TEXT NOT NULL REFERENCES public.api_configs(provider) ON DELETE CASCADE,
    api_key TEXT NOT NULL, -- Encrypted client-side (AES-GCM)
    label TEXT, -- Nickname/Name for the key (e.g. "Key 1 - OpenRouter Free")
    status TEXT DEFAULT 'active', -- 'active' or 'inactive'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (provider, api_key) -- Prevent duplicate entries of the same key
);

-- Index for querying keys by provider
CREATE INDEX IF NOT EXISTS idx_api_keys_provider_status ON public.api_keys(provider, status);

-- 2. Migrate existing keys from api_configs table
INSERT INTO public.api_keys (provider, api_key, label, status)
SELECT provider, api_key, 'Default Key', 'active'
FROM public.api_configs
WHERE api_key IS NOT NULL AND api_key <> ''
ON CONFLICT (provider, api_key) DO NOTHING;

-- 3. Enable RLS (Row Level Security)
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
