// Main Cloudflare Worker entry point for ReplyGenius AI Bot

import { 
  getSupabaseClient, 
  getUser, 
  createUser, 
  checkRateLimit, 
  logUsage, 
  updateUserPreference, 
  getUserPreferences, 
  getUserMemory, 
  updateUserMemory,
  getActivePlans,
  logChatMessage,
  uploadScreenshotToStorage
} from './supabase.js';
import { decryptText } from './crypto.js';
import { getCachedConfigs, clearCache } from './cache.js';
import { generateReplies, generatePromptTemplate } from './ai.js';
import { 
  sendTelegramMessage, 
  sendTelegramAction, 
  downloadTelegramPhoto, 
  setTelegramWebhook,
  forwardPhotoToChannel
} from './telegram.js';
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

    // Route: Admin API - Clear cache
    if (url.pathname === '/admin/clear-cache') {
      clearCache();
      return new Response(JSON.stringify({ success: true, message: "Worker cache cleared." }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Route: Admin API - Generate Prompt using AI
    if (url.pathname === '/admin/generate-prompt' && request.method === 'POST') {
      try {
        const { instruction, promptType } = await request.json();
        if (!instruction || !promptType) {
          return new Response(JSON.stringify({ error: "Missing instruction or promptType" }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const configs = await getCachedConfigs(supabase, decryptText, encryptionKey);
        const activeProvider = configs.activeProvider;

        if (!activeProvider) {
          return new Response(JSON.stringify({ error: "No active AI provider configured." }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const generatedPrompt = await generatePromptTemplate({
          activeProvider,
          instruction,
          promptType
        });

        return new Response(JSON.stringify({ success: true, prompt: generatedPrompt }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
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
  // Load Configurations (1-min cache)
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
  const displayName = fromUser.username ? `@${fromUser.username}` : `${fromUser.first_name || 'User'}`;

  // 1. Check Maintenance Mode
  if (settings.maintenance_mode === 'true') {
    await sendTelegramMessage(botToken, chatId, "🛠️ <b>ReplyGenius AI is currently under maintenance.</b>\nPlease try again later.");
    return;
  }

  // 2. Load or Create User
  let user = await getUser(supabase, telegramId);
  if (!user) {
    user = await createUser(supabase, telegramId, username, fromUser.language_code);
    user = await getUser(supabase, telegramId); // Load again to fetch plans relation
  }

  // 3. Check if user is banned
  if (user.status === 'banned') {
    await sendTelegramMessage(botToken, chatId, "🚫 <b>Access Denied:</b> Your account has been suspended by the administrator.");
    return;
  }

  // Extract Plan configuration
  const userPlan = user.plans || {
    id: 'free',
    name: 'Free Plan',
    daily_limit: 10,
    allow_screenshots: false,
    allow_premium_styles: false
  };

  const dailyLimitValue = settings.free_tier_daily_limit ? parseInt(settings.free_tier_daily_limit) : 10;
  const dailyLimit = userPlan.id === 'free' ? dailyLimitValue : userPlan.daily_limit;

  // 4. Handle System Commands
  const text = message.text ? message.text.trim() : '';
  if (text.startsWith('/')) {
    await handleCommands(text, chatId, telegramId, username, botToken, supabase, userPlan);
    return;
  }

  // 5. Rate Limiting Check
  const rateLimit = await checkRateLimit(supabase, telegramId, dailyLimit, 3);
  if (rateLimit.limited) {
    if (rateLimit.reason === 'minute') {
      await sendTelegramMessage(botToken, chatId, "⚠️ <b>Slow down!</b> You are sending requests too quickly. Please wait a minute.");
    } else {
      await sendTelegramMessage(botToken, chatId, `💳 <b>Daily Limit Reached:</b> You have used all your ${dailyLimit} free generations for today.\n\nType /plan to upgrade and get unlimited replies!`);
    }
    return;
  }

  // 6. Process Input (Text or Image/Screenshot)
  let userInput = text;
  let imageBase64 = null;
  let imageArrayBuffer = null;
  let fileId = null;

  if (message.photo && message.photo.length > 0) {
    // Check if the user plan allows screenshots
    if (!userPlan.allow_screenshots) {
      await sendTelegramMessage(botToken, chatId, "❌ <b>Screenshot Analysis is Locked:</b> Upgrading to Premium allows you to upload chat screenshots and get reply suggestions.\n\nType /plan to see details!");
      return;
    }

    await sendTelegramAction(botToken, chatId, 'upload_photo');
    const largestPhoto = message.photo[message.photo.length - 1];
    fileId = largestPhoto.file_id;
    try {
      const downloaded = await downloadTelegramPhoto(botToken, fileId);
      imageBase64 = downloaded.base64;
      imageArrayBuffer = downloaded.arrayBuffer;
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

  const targetStyle = preferences?.reply_style || 'Casual';

  // Double check Premium style rights
  if ((targetStyle === 'Flirty' || targetStyle === 'Confident') && !userPlan.allow_premium_styles) {
    await sendTelegramMessage(botToken, chatId, `❌ <b>Premium Style Locked:</b> Your current style is set to <b>${targetStyle}</b>, which is a Premium feature.\n\nSet your style to Casual or Funny with /style, or type /plan to upgrade!`);
    return;
  }

  // 9. Call AI Router and upload images in parallel
  try {
    let publicImageUrl = null;
    let uploadPromise = Promise.resolve(null);

    // If an image was uploaded, upload to Supabase Storage and forward to Telegram group
    if (imageArrayBuffer && fileId) {
      const fileName = `${telegramId}_${Date.now()}.jpg`;
      uploadPromise = (async () => {
        try {
          const url = await uploadScreenshotToStorage(supabase, imageArrayBuffer, fileName);
          
          // Forward screenshot to Telegram log channel/group if configured
          if (settings.telegram_log_channel_id) {
            const caption = `📸 <b>New Screenshot Uploaded</b>\n• <b>From:</b> ${displayName} (ID: <code>${telegramId}</code>)\n• <b>Plan:</b> ${userPlan.name}`;
            ctx.waitUntil(forwardPhotoToChannel(botToken, settings.telegram_log_channel_id, fileId, caption));
          }
          return url;
        } catch (e) {
          console.error("Storage upload or log channel forward failed:", e);
          return null;
        }
      })();
    }

    const aiPromise = generateReplies({
      activeProvider,
      settings,
      preferences,
      memorySummary,
      userInput,
      imageBase64,
      targetStyle
    });

    // Run AI call and Storage Upload in parallel to reduce latency
    const [uploadedUrl, replies] = await Promise.all([uploadPromise, aiPromise]);
    publicImageUrl = uploadedUrl;

    const styleKey = targetStyle.toLowerCase();
    const finalReplyText = replies[styleKey] || "Sorry, I couldn't generate a reply in that style.";

    // Send the single text reply directly to the user
    await sendTelegramMessage(botToken, chatId, finalReplyText);

    // 10. Log Chat History & Usage Logs in database
    const userLogText = userInput || '[Uploaded Screenshot]';
    ctx.waitUntil(logChatMessage(supabase, telegramId, 'user', userLogText, publicImageUrl ? { image_url: publicImageUrl } : {}));
    ctx.waitUntil(logChatMessage(supabase, telegramId, 'bot', finalReplyText, { style: targetStyle }));
    ctx.waitUntil(logUsage(supabase, telegramId, imageBase64 ? 'screenshot_analysis' : 'reply_generation'));

    // 11. Trigger Background memory update
    triggerMemorySummarization({
      supabase,
      activeProvider,
      settings,
      telegramId,
      currentSummary: memorySummary,
      userInput: userLogText,
      generatedReplies: replies,
      ctx
    });

  } catch (error) {
    console.error("AI Generation failed:", error);
    await sendTelegramMessage(botToken, chatId, "❌ <b>AI Error:</b> The AI model is currently offline. Please try again later.");
  }
}

/**
 * Handles Telegram bot commands
 */
async function handleCommands(command, chatId, telegramId, username, botToken, supabase, userPlan) {
  if (command === '/start') {
    const welcome = `👋 <b>Welcome to ReplyGenius AI, ${username}!</b>

I generate highly realistic, human-sounding reply suggestions for your chats.

<b>How to use:</b>
1. Paste a message you received (e.g. <i>"what are you doing tonight?"</i>).
2. Or upload a <b>screenshot</b> of a conversation.
3. I'll reply with a message in your preferred style!

Type /style to choose your default style, /plan to view available tiers, or /developer to see about details.`;
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
          { text: `Flirty 😏 ${userPlan.allow_premium_styles ? '' : '🔒'}`, callback_data: "style:Flirty" },
          { text: `Confident 💪 ${userPlan.allow_premium_styles ? '' : '🔒'}`, callback_data: "style:Confident" }
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
    await logChatMessage(supabase, telegramId, 'bot', '[System: Memory reset by user]');
    return;
  }

  if (command === '/developer') {
    const devInfo = `👨‍💻 <b>Developer Information:</b>
    
• Developed by: <b>@anmol_maan</b>
• Hosting: <b>Cloudflare Workers (V8 Isolates)</b>
• Database: <b>Supabase Storage & PostgreSQL</b>
• Mode: <b>MVP 1.0 (Plan & Chat logs enabled)</b>
• Budget: <b>₹0 Startup Cost</b>

<i>Sound exactly like a human would text!</i>`;
    await sendTelegramMessage(botToken, chatId, devInfo);
    return;
  }

  if (command.startsWith('/feedback')) {
    const feedbackText = command.substring(9).trim();
    if (!feedbackText) {
      await sendTelegramMessage(botToken, chatId, "📝 To send feedback, use: <code>/feedback your message here</code>");
      return;
    }

    // Load settings to get log channel ID
    const { data: logSetting } = await supabase.from('settings').select('value').eq('key', 'telegram_log_channel_id').single();
    if (logSetting && logSetting.value) {
      const displayName = username ? `@${username}` : `User_${telegramId}`;
      const forwardMsg = `📝 <b>New Feedback Received:</b>\n• <b>From:</b> ${displayName} (ID: <code>${telegramId}</code>)\n• <b>Plan:</b> ${userPlan.name}\n• <b>Message:</b>\n"${feedbackText}"`;
      
      await sendTelegramMessage(botToken, logSetting.value, forwardMsg);
    }

    await sendTelegramMessage(botToken, chatId, "✅ <b>Thank you!</b> Your feedback has been sent directly to the development team.");
    return;
  }

  if (command === '/plan') {
    try {
      const plans = await getActivePlans(supabase);
      let planMessage = `💎 <b>ReplyGenius AI Subscription Tiers:</b>\n\n`;
      
      plans.forEach(p => {
        const hasOffer = p.offer_price !== null && p.offer_price !== undefined;
        const priceLabel = hasOffer 
          ? `₹${p.offer_price} (<s>Regular ₹${p.price}</s>) / ${p.billing_period}` 
          : `₹${p.price} / ${p.billing_period}`;

        const limitLabel = p.daily_limit === -1 ? 'Unlimited' : `${p.daily_limit} requests / day`;
        
        planMessage += `<b>• ${p.name}</b> (${p.id === userPlan.id ? '<b>Active Plan ✓</b>' : 'Available'})\n`;
        planMessage += `  Price: ${priceLabel}\n`;
        planMessage += `  Limit: ${limitLabel}\n`;
        planMessage += `  Screenshots: ${p.allow_screenshots ? 'Allowed' : 'Not Allowed'}\n`;
        planMessage += `  Styles: ${p.allow_premium_styles ? 'Casual, Funny, Flirty, Confident' : 'Casual, Funny only'}\n\n`;
      });

      planMessage += `💡 <i>Contact @anmol_maan to purchase/upgrade your plan.</i>`;
      await sendTelegramMessage(botToken, chatId, planMessage);
    } catch (e) {
      await sendTelegramMessage(botToken, chatId, "❌ Failed to fetch plans list. Please try again later.");
    }
    return;
  }

  if (command === '/help') {
    const helpText = `ℹ️ <b>ReplyGenius AI Help Menu</b>

• <b>Direct replies</b>: Simply send any text snippet you want a reply for.
• <b>Screenshot upload</b>: Send a picture/screenshot of a chat thread (Premium only).
• /style: Change your default reply style preference.
• /plan: View subscription plans, prices, and offers.
• /developer: Show developer credits.
• /feedback: Send feedback to the developer.
• /reset: Reset your conversation context memory.

Your current plan is: <b>${userPlan.name}</b>.`;
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
  const telegramId = callbackQuery.from.id;
  const data = callbackQuery.data;

  // Answer Callback Query so Telegram stops loading spinner
  const answerUrl = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
  await fetch(answerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQuery.id,
      text: "Loading style..."
    })
  });

  if (data.startsWith('style:')) {
    const chosenStyle = data.split(':')[1];
    
    try {
      // Load user plan to check permissions
      const user = await getUser(supabase, telegramId);
      const userPlan = user?.plans || { id: 'free', allow_premium_styles: false };

      if ((chosenStyle === 'Flirty' || chosenStyle === 'Confident') && !userPlan.allow_premium_styles) {
        const lockedMsg = `❌ <b>Premium Style Locked:</b> Flirty and Confident styles are premium features. Upgrade your plan with /plan to unlock them!`;
        await sendTelegramMessage(botToken, chatId, lockedMsg);
        return;
      }

      await updateUserPreference(supabase, telegramId, { reply_style: chosenStyle });
      
      const confirmMsg = `✅ <b>Success:</b> Default reply style updated to <b>${chosenStyle}</b>. Next chat snippet you send will generate this style!`;
      await sendTelegramMessage(botToken, chatId, confirmMsg);
    } catch (e) {
      console.error(e);
      await sendTelegramMessage(botToken, chatId, "❌ Failed to update style preference. Please try again.");
    }
  }
}
