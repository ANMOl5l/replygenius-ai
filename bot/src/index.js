// Main Cloudflare Worker entry point for ReplyGenius AI Bot

import { getSupabaseClient, getUser, createUser, checkRateLimit, logUsage, updateUserPreference, getUserPreferences, getUserMemory, updateUserMemory } from './supabase.js';
import { decryptText } from './crypto.js';
import { getCachedConfigs, clearCache } from './cache.js';
import { generateReplies } from './ai.js';
import { sendTelegramMessage, sendTelegramAction, downloadTelegramPhoto, setTelegramWebhook } from './telegram.js';
import { triggerMemorySummarization } from './memory.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS Headers for Admin Panel
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Initialize Supabase Client
    let supabase;
    try {
      supabase = getSupabaseClient(env);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      });
    }

    const encryptionKey = env.SECRET_ENCRYPTION_KEY;

    // Route: Admin API - Clear cache (called by admin panel when configs update)
    if (url.pathname === '/admin/clear-cache') {
      clearCache();
      return new Response(JSON.stringify({ success: true, message: "Worker cache cleared." }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Route: Admin API - Setup Webhook
    if (url.pathname === '/admin/setup-webhook' && request.method === 'POST') {
      try {
        const { botTokenEncrypted, workerDomain } = await request.json();
        if (!botTokenEncrypted || !workerDomain) {
          return new Response(JSON.stringify({ error: "Missing botTokenEncrypted or workerDomain" }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        const decryptedToken = await decryptText(botTokenEncrypted, encryptionKey);
        const webhookUrl = `https://${workerDomain}/webhook`;
        
        const result = await setTelegramWebhook(decryptedToken, webhookUrl);
        return new Response(JSON.stringify({ success: true, result }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // Route: Telegram Webhook
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        await handleTelegramUpdate(update, supabase, encryptionKey, ctx);
        return new Response("OK", { status: 200 });
      } catch (error) {
        console.error("Error handling webhook update:", error);
        return new Response("Error", { status: 500 });
      }
    }

    // Fallback: 404
    return new Response("ReplyGenius AI Worker Running", { status: 200 });
  }
};

/**
 * Main handler for Telegram Updates
 */
async function handleTelegramUpdate(update, supabase, encryptionKey, ctx) {
  // Load Configurations (uses 1-minute TTL cache)
  const configs = await getCachedConfigs(supabase, decryptText, encryptionKey);
  const settings = configs.settings;
  const activeProvider = configs.activeProvider;
  const botToken = settings.telegram_bot_token;

  if (!botToken) {
    console.error("Telegram Bot Token is not set. Update in database/settings table.");
    return;
  }

  // Handle Callback Queries (button clicks)
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, supabase, botToken);
    return;
  }

  // Handle Messages
  if (!update.message) return;
  const message = update.message;
  const chatId = message.chat.id;
  const fromUser = message.from;

  if (!fromUser || fromUser.is_bot) return;

  const telegramId = fromUser.id;
  const username = fromUser.username || fromUser.first_name || `User_${telegramId}`;

  // 1. Check Maintenance Mode
  if (settings.maintenance_mode === 'true') {
    await sendTelegramMessage(botToken, chatId, "🛠️ <b>ReplyGenius AI is currently under maintenance.</b>\nPlease try again later.");
    return;
  }

  // 2. Load or Create User
  let user = await getUser(supabase, telegramId);
  if (!user) {
    user = await createUser(supabase, telegramId, username, fromUser.language_code);
  }

  // 3. Check if user is banned
  if (user.status === 'banned') {
    await sendTelegramMessage(botToken, chatId, "🚫 <b>Access Denied:</b> Your account has been suspended by the administrator.");
    return;
  }

  // 4. Handle System Commands
  const text = message.text ? message.text.trim() : '';
  if (text.startsWith('/')) {
    await handleCommands(text, chatId, telegramId, username, botToken, supabase);
    return;
  }

  // 5. Rate Limiting Check
  // Free limits: 10 requests per 24 hours, 3 per minute
  const rateLimit = await checkRateLimit(supabase, telegramId, 10, 3);
  if (rateLimit.limited) {
    if (rateLimit.reason === 'minute') {
      await sendTelegramMessage(botToken, chatId, "⚠️ <b>Slow down!</b> You are sending requests too quickly. Please wait a minute.");
    } else {
      await sendTelegramMessage(botToken, chatId, "💳 <b>Daily Limit Reached:</b> You have used all 10 free generations for today.\n\n<i>Premium plan (unlimited) is coming soon!</i>");
    }
    return;
  }

  // 6. Process Input (Text or Image/Screenshot)
  let userInput = text;
  let imageBase64 = null;

  if (message.photo && message.photo.length > 0) {
    await sendTelegramAction(botToken, chatId, 'upload_photo');
    // Get the largest photo size available
    const largestPhoto = message.photo[message.photo.length - 1];
    try {
      imageBase64 = await downloadTelegramPhoto(botToken, largestPhoto.file_id);
    } catch (e) {
      await sendTelegramMessage(botToken, chatId, "❌ Failed to download the screenshot. Please try sending it again.");
      return;
    }
  }

  if (!userInput && !imageBase64) {
    await sendTelegramMessage(botToken, chatId, "👋 Send me a message, a conversation snippet, or a screenshot of a chat, and I will generate natural, human-like replies for you!");
    return;
  }

  // 7. Send "Typing" Action to Telegram
  await sendTelegramAction(botToken, chatId, 'typing');

  // 8. Load Memory and Preferences
  const [preferences, memorySummary] = await Promise.all([
    getUserPreferences(supabase, telegramId),
    getUserMemory(supabase, telegramId)
  ]);

  // 9. Call AI Router to generate replies
  try {
    const replies = await generateReplies({
      activeProvider,
      settings,
      preferences,
      memorySummary,
      userInput,
      imageBase64
    });

    // Format the response message
    const responseMsg = `✨ <b>Generated Replies:</b>
    
😌 <b>Casual:</b>
<i>"${replies.casual || 'No response generated.'}"</i>

😭 <b>Funny:</b>
<i>"${replies.funny || 'No response generated.'}"</i>

😏 <b>Flirty:</b>
<i>"${replies.flirty || 'No response generated.'}"</i>

💪 <b>Confident:</b>
<i>"${replies.confident || 'No response generated.'}"</i>

💡 <i>Current Mode: <b>${preferences.reply_style}</b>. Type /style to change.</i>`;

    await sendTelegramMessage(botToken, chatId, responseMsg);

    // 10. Log Usage
    await logUsage(supabase, telegramId, imageBase64 ? 'screenshot_analysis' : 'reply_generation');

    // 11. Trigger Background memory update using ctx.waitUntil
    triggerMemorySummarization({
      supabase,
      activeProvider,
      settings,
      telegramId,
      currentSummary: memorySummary,
      userInput: userInput || '[Conversation screenshot analyzed]',
      generatedReplies: replies,
      ctx
    });

  } catch (error) {
    console.error("AI Generation failed:", error);
    await sendTelegramMessage(botToken, chatId, "❌ <b>AI Generation Error:</b> The active AI model is currently offline or misconfigured. Please contact support or try again later.");
  }
}

/**
 * Handles Telegram bot commands
 */
async function handleCommands(command, chatId, telegramId, username, botToken, supabase) {
  if (command === '/start') {
    const welcome = `👋 <b>Welcome to ReplyGenius AI, ${username}!</b>

I generate highly realistic, human-sounding reply suggestions for dating, friends, or work conversations. No corporate speak, no cheesy robotic lines.

<b>How to use:</b>
1. Paste a message you received (e.g. <i>"She said okay"</i>).
2. Or upload a <b>screenshot</b> of a conversation.
3. I'll output suggestions in 4 distinct styles: Casual 😌, Funny 😭, Flirty 😏, and Confident 💪.

Type /style to choose your default preference, or /reset to wipe out the bot's memory context.`;
    await sendTelegramMessage(botToken, chatId, welcome);
    return;
  }

  if (command === '/style') {
    const keyboard = {
      inline_keyboard: [
        [
          { text: "Casual 😌", callback_data: "style:Casual" },
          { text: "Funny 😭", callback_data: "style:Funny" }
        ],
        [
          { text: "Flirty 😏", callback_data: "style:Flirty" },
          { text: "Confident 💪", callback_data: "style:Confident" }
        ]
      ]
    };
    await sendTelegramMessage(botToken, chatId, "🎯 <b>Select your default Reply Style:</b>", {
      reply_markup: keyboard
    });
    return;
  }

  if (command === '/reset') {
    await updateUserMemory(supabase, telegramId, 'New session started. Previous context cleared.');
    await sendTelegramMessage(botToken, chatId, "🧼 <b>Memory Wiped:</b> The bot has cleared all past conversation memory for your chat.");
    return;
  }

  if (command === '/help') {
    const helpText = `ℹ️ <b>ReplyGenius AI Help Menu</b>

• <b>Direct replies</b>: Simply send any text like: <i>"Hey, what are you doing tonight?"</i>
• <b>Screen upload</b>: Send a picture/screenshot of a chat thread.
• /style: Change your default reply style preference.
• /reset: Reset your conversation summaries.
• /start: Re-run setup instructions.

<i>Your daily usage limit is reset every 24 hours.</i>`;
    await sendTelegramMessage(botToken, chatId, helpText);
    return;
  }

  // Unknown command
  await sendTelegramMessage(botToken, chatId, "❓ Unknown command. Type /help to see all available actions.");
}

/**
 * Handles Callback Queries (button clicks)
 */
async function handleCallbackQuery(callbackQuery, supabase, botToken) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const telegramId = callbackQuery.from.id;
  const data = callbackQuery.data;

  // Answer Callback Query so Telegram stops showing loading state
  const answerUrl = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
  await fetch(answerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQuery.id,
      text: "Setting saved!"
    })
  });

  if (data.startsWith('style:')) {
    const chosenStyle = data.split(':')[1];
    try {
      await updateUserPreference(supabase, telegramId, { reply_style: chosenStyle });
      
      const confirmMsg = `✅ <b>Success:</b> Default reply style has been updated to <b>${chosenStyle}</b>. Send me a chat snippet to test it out!`;
      
      // Send a new message, delete or edit the selection block
      await sendTelegramMessage(botToken, chatId, confirmMsg);
    } catch (e) {
      console.error(e);
      await sendTelegramMessage(botToken, chatId, "❌ Failed to update style preference. Please try again.");
    }
  }
}
