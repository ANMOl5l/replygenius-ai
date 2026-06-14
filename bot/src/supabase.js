import { createClient } from '@supabase/supabase-js';

let supabaseInstance = null;

export function getSupabaseClient(env) {
  if (!supabaseInstance) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase configuration env variables.");
    }
    supabaseInstance = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }
  return supabaseInstance;
}

// --- User Operations ---

export async function getUser(supabase, telegramId) {
  const { data, error } = await supabase
    .from('users')
    .select('*, plans(*)')
    .eq('id', telegramId)
    .single();
  
  if (error && error.code !== 'PGRST116') { // PGRST116 is code for "no rows returned"
    console.error("Error fetching user:", error);
  }
  return data;
}

export async function createUser(supabase, telegramId, username, language = 'en') {
  // Insert User
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert([{ id: telegramId, username, language }])
    .select()
    .single();

  if (userError) {
    console.error("Error creating user:", userError);
    throw userError;
  }

  // Create default preferences
  const { error: prefError } = await supabase
    .from('preferences')
    .insert([{ user_id: telegramId }]);

  if (prefError) {
    console.error("Error creating user preferences:", prefError);
  }

  // Create default memory summary
  const { error: memError } = await supabase
    .from('memory')
    .insert([{ user_id: telegramId, summary: 'New user registered. Chat style is casual by default.' }]);

  if (memError) {
    console.error("Error creating user memory:", memError);
  }

  return user;
}

// --- Preferences & Memory ---

export async function getUserPreferences(supabase, telegramId) {
  const { data, error } = await supabase
    .from('preferences')
    .select('*')
    .eq('user_id', telegramId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error("Error fetching preferences:", error);
  }
  return data;
}

export async function updateUserPreference(supabase, telegramId, updates) {
  const { data, error } = await supabase
    .from('preferences')
    .update(updates)
    .eq('user_id', telegramId)
    .select()
    .single();

  if (error) {
    console.error("Error updating preferences:", error);
    throw error;
  }
  return data;
}

export async function getUserMemory(supabase, telegramId) {
  const { data, error } = await supabase
    .from('memory')
    .select('summary')
    .eq('user_id', telegramId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error("Error fetching memory:", error);
  }
  return data ? data.summary : '';
}

export async function updateUserMemory(supabase, telegramId, summary) {
  const { data, error } = await supabase
    .from('memory')
    .update({ summary, updated_at: new Date().toISOString() })
    .eq('user_id', telegramId)
    .select()
    .single();

  if (error) {
    console.error("Error updating memory:", error);
    throw error;
  }
  return data;
}

// --- Rate Limiting & Logs ---

export async function logUsage(supabase, telegramId, action) {
  const { error } = await supabase
    .from('usage_logs')
    .insert([{ user_id: telegramId, action }]);

  if (error) {
    console.error("Error logging usage:", error);
  }
}

export async function checkRateLimit(supabase, telegramId, dailyLimit = 10, rpmLimit = 3) {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000).toISOString();

  // If dailyLimit is -1, it means unlimited! So we skip the daily check.
  if (dailyLimit !== -1) {
    // Get daily count
    const { count: dailyCount, error: dailyError } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', telegramId)
      .gte('timestamp', oneDayAgo);

    if (dailyError) {
      console.error("Error checking daily rate limit:", dailyError);
      return { limited: false, error: dailyError };
    }

    if (dailyCount >= dailyLimit) {
      return { limited: true, reason: 'daily', limit: dailyLimit, count: dailyCount };
    }
  }

  // Get minute count
  const { count: minuteCount, error: minuteError } = await supabase
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', telegramId)
    .gte('timestamp', oneMinuteAgo);

  if (minuteError) {
    console.error("Error checking RPM rate limit:", minuteError);
    return { limited: false, error: minuteError };
  }

  if (minuteCount >= rpmLimit) {
    return { limited: true, reason: 'minute', limit: rpmLimit, count: minuteCount };
  }

  return { limited: false };
}

// --- Configurations & Settings ---

export async function getApiConfigs(supabase) {
  const { data, error } = await supabase
    .from('api_configs')
    .select('*');

  if (error) {
    console.error("Error fetching API configs:", error);
    throw error;
  }
  return data;
}

export async function getSettings(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('*');

  if (error) {
    console.error("Error fetching settings:", error);
    throw error;
  }
  
  // Transform list of {key, value} to a key-value object
  const settingsObj = {};
  data.forEach(item => {
    settingsObj[item.key] = item.value;
  });
  return settingsObj;
}

// --- Plans, Chat Logging & Storage ---

export async function getActivePlans(supabase) {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('status', 'active');

  if (error) {
    console.error("Error fetching active plans:", error);
    throw error;
  }
  return data || [];
}

export async function logChatMessage(supabase, userId, sender, content, metadata = {}) {
  const { error } = await supabase
    .from('messages')
    .insert([{ user_id: userId, sender, content, metadata }]);

  if (error) {
    console.error("Error logging chat message:", error);
  }
}

export async function uploadScreenshotToStorage(supabase, fileBuffer, fileName) {
  const { data, error } = await supabase.storage
    .from('screenshots')
    .upload(fileName, fileBuffer, {
      contentType: 'image/jpeg',
      upsert: true
    });

  if (error) {
    console.error("Error uploading screenshot to storage:", error);
    throw error;
  }

  const { data: urlData } = supabase.storage.from('screenshots').getPublicUrl(fileName);
  return urlData.publicUrl;
}

export async function getApiKeys(supabase) {
  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('status', 'active');

  if (error) {
    console.error("Error fetching API keys:", error);
    throw error;
  }
  return data || [];
}
