// Background Memory Summarization for ReplyGenius AI
// Utilizes Cloudflare Worker's ctx.waitUntil to compress context without blocking the response

import { summarizeConversation } from './ai.js';
import { updateUserMemory } from './supabase.js';

/**
 * Triggers background conversation summarization and updates the Supabase memory table.
 * Does not block the main response thread.
 */
export function triggerMemorySummarization({
  supabase,
  activeProvider,
  settings,
  telegramId,
  currentSummary,
  userInput,
  generatedReplies,
  ctx
}) {
  // If no AI provider is configured, we can't summarize
  if (!activeProvider || !activeProvider.apiKey) {
    return;
  }

  const backgroundTask = async () => {
    try {
      console.log(`Starting background memory summarization for user ${telegramId}...`);
      
      const updatedSummary = await summarizeConversation({
        activeProvider,
        settings,
        currentSummary,
        userInput,
        generatedReplies
      });

      if (updatedSummary && updatedSummary !== currentSummary) {
        await updateUserMemory(supabase, telegramId, updatedSummary);
        console.log(`Background memory update complete for user ${telegramId}.`);
      } else {
        console.log(`Memory unchanged for user ${telegramId}.`);
      }
    } catch (error) {
      console.error(`Error in background memory summarization for user ${telegramId}:`, error);
    }
  };

  // Run asynchronously without delaying the current bot reply
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(backgroundTask());
  } else {
    // Fallback for environments where ctx.waitUntil is not available (e.g. testing)
    backgroundTask();
  }
}
