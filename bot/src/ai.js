// AI Router for ReplyGenius AI
// Integrates OpenRouter, OpenAI, Gemini, Claude, and Groq

/**
 * Generates four reply options (casual, funny, flirty, confident) based on preferences and memory context.
 * Supports image analysis if imageBase64 is provided.
 */
export async function generateReplies({
  activeProvider,
  settings,
  preferences,
  memorySummary,
  userInput,
  imageBase64 = null,
  targetStyle = null
}) {
  if (!activeProvider || (!activeProvider.apiKey && (!activeProvider.keys || activeProvider.keys.length === 0))) {
    throw new Error("No active AI provider configured or API key is missing.");
  }

  const { provider, keys, modelName } = activeProvider;
  const keyPool = (keys && keys.length > 0) ? keys : [activeProvider.apiKey];

  // Construct core prompt instructions
  let systemPrompt = '';
  if (targetStyle) {
    const styleKey = targetStyle.toLowerCase();
    const stylePrompt = settings[`prompt_style_${styleKey}`];
    
    systemPrompt = `${settings.prompt_system_core}
You must analyze the incoming conversation context and suggest exactly one reply matching this style:
${targetStyle}: ${stylePrompt}

Format the output strictly as a JSON object with a single key "${styleKey}" containing the generated text.
Do not include any extra introductory text, explanation, or markdown code blocks (e.g. \`\`\`json). Just return raw JSON.`;
  } else {
    systemPrompt = `${settings.prompt_system_core}
You must analyze the incoming conversation context and suggest four replies matching these exact styles:
1. Casual: ${settings.prompt_style_casual}
2. Funny: ${settings.prompt_style_funny}
3. Flirty: ${settings.prompt_style_flirty}
4. Confident: ${settings.prompt_style_confident}

Format the output strictly as a JSON object with keys: "casual", "funny", "flirty", "confident".
Do not include any extra introductory text, explanation, or markdown code blocks (e.g. \`\`\`json). Just return raw JSON.`;
  }

  const userContextPrompt = `User Preferences:
- Reply Style Preference: ${preferences.reply_style}
- Language: ${preferences.language}
- Personality: ${preferences.personality}

Memory Summary of past interactions:
"${memorySummary || 'No past context.'}"

Input to reply to:
"${userInput || '[Image uploaded]'}"`;

  let responseText = '';

  if (provider === 'openai' || provider === 'openrouter' || provider === 'groq') {
    responseText = await callWithFailover(keyPool, (key) =>
      callOpenAICompatible({
        provider,
        apiKey: key,
        model: modelName,
        systemPrompt,
        userContextPrompt,
        imageBase64
      })
    );
  } else if (provider === 'gemini') {
    responseText = await callWithFailover(keyPool, (key) =>
      callGemini({
        apiKey: key,
        model: modelName,
        systemPrompt,
        userContextPrompt,
        imageBase64
      })
    );
  } else if (provider === 'claude') {
    responseText = await callWithFailover(keyPool, (key) =>
      callClaude({
        apiKey: key,
        model: modelName,
        systemPrompt,
        userContextPrompt,
        imageBase64
      })
    );
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  // Parse JSON response
  try {
    // Strip markdown code block wrappers if any were returned by the AI
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse AI response JSON:", responseText, e);
    // Fallback parser in case AI didn't return perfect JSON
    if (targetStyle) {
      const styleKey = targetStyle.toLowerCase();
      return { [styleKey]: responseText.trim() };
    }
    return extractFallbackReplies(responseText, userInput);
  }
}

/**
 * Helper to call an API function with failover support across a pool of API keys.
 * Shuffles the keys to distribute load, then tries each key sequentially.
 * Only retries on retriable errors (e.g., status 429, 500, 401, etc.).
 */
async function callWithFailover(keys, apiCallFunction) {
  if (!keys || keys.length === 0) {
    throw new Error("No API keys available in the key pool.");
  }

  // Shuffle keys to distribute load
  const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);
  const errors = [];

  for (let i = 0; i < shuffledKeys.length; i++) {
    const key = shuffledKeys[i];
    try {
      return await apiCallFunction(key);
    } catch (err) {
      console.warn(`API call failed with key index ${i} (failover candidate):`, err.message || err);
      errors.push(err);
      
      const errorMsg = (err.message || '').toLowerCase();
      // Fail fast on status 400 Bad Request
      const isStatus400 = errorMsg.includes("status 400") || err.status === 400;
      if (isStatus400) {
        throw err;
      }
    }
  }

  throw new Error(`All API keys in the pool failed. Errors: [${errors.map(e => e.message || e).join(', ')}]`);
}

/**
 * Calls OpenAI, OpenRouter, or Groq (since they share the chat completions format).
 */
async function callOpenAICompatible({ provider, apiKey, model, systemPrompt, userContextPrompt, imageBase64 }) {
  let endpoint = 'https://api.openai.com/v1/chat/completions';
  if (provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  } else if (provider === 'groq') {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  }

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  if (imageBase64) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userContextPrompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${imageBase64}`
          }
        }
      ]
    });
  } else {
    messages.push({ role: 'user', content: userContextPrompt });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/anmol_maan/replygenius', // OpenRouter metadata
      'X-Title': 'ReplyGenius AI'
    },
    body: JSON.stringify({
      model: model || (provider === 'groq' ? 'llama-3.3-70b-versatile' : (provider === 'openrouter' ? 'google/gemini-2.5-flash' : 'gpt-4o-mini')),
      messages,
      response_format: { type: 'json_object' }, // Enforce JSON if supported
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`API Error from ${provider}: ${response.status} - ${errorText}`);
    err.status = response.status;
    throw err;
  }

  const json = await response.json();
  return json.choices[0].message.content;
}

/**
 * Calls Gemini API.
 */
async function callGemini({ apiKey, model, systemPrompt, userContextPrompt, imageBase64 }) {
  // Use Gemini OpenAI-compatible completions endpoint which handles vision easily
  const modelName = model || 'gemini-1.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/chat/completions`;

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  if (imageBase64) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userContextPrompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${imageBase64}`
          }
        }
      ]
    });
  } else {
    messages.push({ role: 'user', content: userContextPrompt });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`API Error from Gemini: ${response.status} - ${errorText}`);
    err.status = response.status;
    throw err;
  }

  const json = await response.json();
  return json.choices[0].message.content;
}

/**
 * Calls Anthropic Claude API.
 */
async function callClaude({ apiKey, model, systemPrompt, userContextPrompt, imageBase64 }) {
  const modelName = model || 'claude-3-5-sonnet-latest';
  const endpoint = 'https://api.anthropic.com/v1/messages';

  const content = [];
  if (imageBase64) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: imageBase64
      }
    });
  }
  content.push({ type: 'text', text: userContextPrompt });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: modelName,
      system: systemPrompt,
      messages: [
        { role: 'user', content }
      ],
      max_tokens: 1000,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`API Error from Claude: ${response.status} - ${errorText}`);
    err.status = response.status;
    throw err;
  }

  const json = await response.json();
  return json.content[0].text;
}

/**
 * Compact summarizer for conversation compression.
 */
export async function summarizeConversation({
  activeProvider,
  settings,
  currentSummary,
  userInput,
  generatedReplies
}) {
  if (!activeProvider || (!activeProvider.apiKey && (!activeProvider.keys || activeProvider.keys.length === 0))) return currentSummary;

  const { provider, keys, modelName } = activeProvider;
  const keyPool = (keys && keys.length > 0) ? keys : [activeProvider.apiKey];

  const summarizerPrompt = `You are a helper that maintains a compact memory summary of a user's conversations.
Your task is to merge the current memory summary with the new interaction and return a updated, single paragraph summary (max 3 sentences).
Keep key preferences, language choices, or specific traits (e.g. "likes short flirty responses", "speaks Hinglish").

Current Memory Summary:
"${currentSummary || 'None.'}"

New Interaction:
- Input received: "${userInput || '[Image screenshot analyzed]'}"
- Generated reply options: ${JSON.stringify(generatedReplies)}

Return only the updated summary paragraph. Do not write anything else.`;

  try {
    let responseText = '';

    if (provider === 'openai' || provider === 'openrouter' || provider === 'groq') {
      responseText = await callWithFailover(keyPool, (key) =>
        callOpenAICompatible({
          provider,
          apiKey: key,
          model: modelName,
          systemPrompt: "You are a database summarization bot. Answer in one short paragraph.",
          userContextPrompt: summarizerPrompt
        })
      );
    } else if (provider === 'gemini') {
      responseText = await callWithFailover(keyPool, (key) =>
        callGemini({
          apiKey: key,
          model: modelName,
          systemPrompt: "You are a database summarization bot. Answer in one short paragraph.",
          userContextPrompt: summarizerPrompt
        })
      );
    } else if (provider === 'claude') {
      responseText = await callWithFailover(keyPool, (key) =>
        callClaude({
          apiKey: key,
          model: modelName,
          systemPrompt: "You are a database summarization bot. Answer in one short paragraph.",
          userContextPrompt: summarizerPrompt
        })
      );
    }

    return responseText.trim();
  } catch (e) {
    console.error("Failed to run background summarizer:", e);
    return currentSummary; // Return old summary on failure
  }
}

/**
 * Parse helper in case JSON parsing completely fails.
 */
function extractFallbackReplies(text, userInput) {
  console.log("Attempting fallback text parsing...");
  const cleanText = text.toLowerCase();
  
  const extractForType = (type) => {
    const startIdx = cleanText.indexOf(type);
    if (startIdx !== -1) {
      const line = text.substring(startIdx);
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1 && colonIdx < 15) {
        const value = line.substring(colonIdx + 1).split('\n')[0].replace(/["'{}]/g, '').trim();
        if (value) return value;
      }
    }
    return '';
  };

  const casual = extractForType('casual') || "here we go";
  const funny = extractForType('funny') || "wait, what? 😭";
  const flirty = extractForType('flirty') || "hey there 😏";
  const confident = extractForType('confident') || "sounds good.";

  return { casual, funny, flirty, confident };
}

/**
 * Meta-prompt engineering helper to generate optimal prompts from descriptions.
 */
export async function generatePromptTemplate({
  activeProvider,
  instruction,
  promptType
}) {
  if (!activeProvider || (!activeProvider.apiKey && (!activeProvider.keys || activeProvider.keys.length === 0))) {
    throw new Error("No active AI provider configured or API key is missing.");
  }

  const { provider, keys, modelName } = activeProvider;
  const keyPool = (keys && keys.length > 0) ? keys : [activeProvider.apiKey];

  const promptTypeLabel = {
    core: "Core System Prompt (defines the general personality and tone of the bot)",
    casual: "Casual Style parameter (direct instructions on how to text casually)",
    funny: "Funny Style parameter (direct instructions on how to reply wittily/sarcastically)",
    flirty: "Flirty Style parameter (direct instructions on how to tease/attract)",
    confident: "Confident Style parameter (direct instructions on how to reply assuredly)"
  }[promptType] || "System Prompt Component";

  const systemPrompt = "You are a prompt engineering expert. You output only direct instruction text without any formatting, quotes, explanations or markdown block indicators.";
  const userContextPrompt = `The user wants to generate or modify the prompt instructions for a Telegram Reply bot.
Target Component: ${promptTypeLabel}
User instruction/requirement: "${instruction}"

Generate a highly optimized, concise, and direct prompt instruction in English.
Do not include any introductory sentences, meta-commentary, or markdown blocks (e.g. \`\`\`).
Return ONLY the raw prompt text that will be fed to the AI. Do not wrap in quotation marks.`;

  let responseText = '';

  if (provider === 'openai' || provider === 'openrouter' || provider === 'groq') {
    responseText = await callWithFailover(keyPool, (key) =>
      callOpenAICompatible({
        provider,
        apiKey: key,
        model: modelName,
        systemPrompt,
        userContextPrompt
      })
    );
  } else if (provider === 'gemini') {
    responseText = await callWithFailover(keyPool, (key) =>
      callGemini({
        apiKey: key,
        model: modelName,
        systemPrompt,
        userContextPrompt
      })
    );
  } else if (provider === 'claude') {
    responseText = await callWithFailover(keyPool, (key) =>
      callClaude({
        apiKey: key,
        model: modelName,
        systemPrompt,
        userContextPrompt
      })
    );
  }

  return responseText.trim();
}
