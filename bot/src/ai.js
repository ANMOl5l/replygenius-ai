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
  imageBase64 = null
}) {
  if (!activeProvider || !activeProvider.apiKey) {
    throw new Error("No active AI provider configured or API key is missing.");
  }

  const { provider, apiKey, modelName } = activeProvider;

  // Construct core prompt instructions
  const systemPrompt = `${settings.prompt_system_core}
You must analyze the incoming conversation context and suggest four replies matching these exact styles:
1. Casual: ${settings.prompt_style_casual}
2. Funny: ${settings.prompt_style_funny}
3. Flirty: ${settings.prompt_style_flirty}
4. Confident: ${settings.prompt_style_confident}

Format the output strictly as a JSON object with keys: "casual", "funny", "flirty", "confident".
Do not include any extra introductory text, explanation, or markdown code blocks (e.g. \`\`\`json). Just return raw JSON.`;

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
    responseText = await callOpenAICompatible({
      provider,
      apiKey,
      model: modelName,
      systemPrompt,
      userContextPrompt,
      imageBase64
    });
  } else if (provider === 'gemini') {
    responseText = await callGemini({
      apiKey,
      model: modelName,
      systemPrompt,
      userContextPrompt,
      imageBase64
    });
  } else if (provider === 'claude') {
    responseText = await callClaude({
      apiKey,
      model: modelName,
      systemPrompt,
      userContextPrompt,
      imageBase64
    });
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
    return extractFallbackReplies(responseText, userInput);
  }
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
    throw new Error(`API Error from ${provider}: ${response.status} - ${errorText}`);
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
    throw new Error(`API Error from Gemini: ${response.status} - ${errorText}`);
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
    throw new Error(`API Error from Claude: ${response.status} - ${errorText}`);
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
  if (!activeProvider || !activeProvider.apiKey) return currentSummary;

  const { provider, apiKey, modelName } = activeProvider;

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
      responseText = await callOpenAICompatible({
        provider,
        apiKey,
        model: modelName,
        systemPrompt: "You are a database summarization bot. Answer in one short paragraph.",
        userContextPrompt: summarizerPrompt
      });
    } else if (provider === 'gemini') {
      responseText = await callGemini({
        apiKey,
        model: modelName,
        systemPrompt: "You are a database summarization bot. Answer in one short paragraph.",
        userContextPrompt: summarizerPrompt
      });
    } else if (provider === 'claude') {
      responseText = await callClaude({
        apiKey,
        model: modelName,
        systemPrompt: "You are a database summarization bot. Answer in one short paragraph.",
        userContextPrompt: summarizerPrompt
      });
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
