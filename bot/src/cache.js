import { getSettings, getApiConfigs } from './supabase.js';

let cachedData = null;
let cacheExpiry = 0;

/**
 * Gets cached database configurations, decodes secrets, and finds the active provider.
 * Cache TTL defaults to 60 seconds.
 */
export async function getCachedConfigs(supabase, decryptText, encryptionKey, ttlMs = 60000) {
  const now = Date.now();
  if (cachedData && now < cacheExpiry) {
    return cachedData;
  }

  try {
    // Fetch settings and API configs from Supabase in parallel
    const [settings, configs] = await Promise.all([
      getSettings(supabase),
      getApiConfigs(supabase)
    ]);

    // Decrypt Telegram Bot Token if set
    if (settings.telegram_bot_token) {
      try {
        settings.telegram_bot_token = await decryptText(settings.telegram_bot_token, encryptionKey);
      } catch (e) {
        console.error("Failed to decrypt Telegram bot token:", e);
        settings.telegram_bot_token = ''; // Clear out invalid tokens
      }
    }

    // Decrypt all provider API keys and find the active one
    let activeProvider = null;
    const decryptedConfigs = {};

    for (const conf of configs) {
      let decryptedKey = '';
      if (conf.api_key) {
        try {
          decryptedKey = await decryptText(conf.api_key, encryptionKey);
        } catch (e) {
          console.error(`Failed to decrypt API key for provider ${conf.provider}:`, e);
        }
      }

      decryptedConfigs[conf.provider] = {
        provider: conf.provider,
        apiKey: decryptedKey,
        status: conf.status,
        modelName: conf.model_name
      };

      if (conf.status === 'active') {
        activeProvider = decryptedConfigs[conf.provider];
      }
    }

    cachedData = {
      settings,
      apiConfigs: decryptedConfigs,
      activeProvider
    };
    cacheExpiry = Date.now() + ttlMs;

    return cachedData;
  } catch (error) {
    console.error("Error loading and decrypting settings/configs:", error);
    // If database is down or decrypting completely fails, return old cache if present, else empty shell
    if (cachedData) return cachedData;
    return {
      settings: {},
      apiConfigs: {},
      activeProvider: null
    };
  }
}

/**
 * Clears the in-memory cache to force a re-fetch on the next request.
 * Useful when the admin panel updates settings.
 */
export function clearCache() {
  cachedData = null;
  cacheExpiry = 0;
}
