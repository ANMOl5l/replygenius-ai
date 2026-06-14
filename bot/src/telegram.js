// Telegram Bot API Helpers for Cloudflare Workers

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Sends a message to a Telegram chat.
 */
export async function sendTelegramMessage(token, chatId, text, options = {}) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...options
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`Error sending Telegram message: ${response.status} - ${err}`);
  }
  return response;
}

/**
 * Sends a typing/uploading chat action.
 */
export async function sendTelegramAction(token, chatId, action = 'typing') {
  const url = `https://api.telegram.org/bot${token}/sendChatAction`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action
      })
    });
  } catch (e) {
    console.error("Failed to send chat action:", e);
  }
}

/**
 * Downloads a photo from Telegram servers and returns its base64 string.
 */
export async function downloadTelegramPhoto(token, fileId) {
  // 1. Get file path via getFile API
  const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
  const getFileRes = await fetch(getFileUrl);
  if (!getFileRes.ok) {
    throw new Error(`Failed to get file info from Telegram: ${getFileRes.statusText}`);
  }

  const fileData = await getFileRes.json();
  if (!fileData.ok || !fileData.result.file_path) {
    throw new Error("Telegram getFile returned invalid data.");
  }

  const filePath = fileData.result.file_path;

  // 2. Download file content
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const downloadRes = await fetch(downloadUrl);
  if (!downloadRes.ok) {
    throw new Error(`Failed to download image file: ${downloadRes.statusText}`);
  }

  const buffer = await downloadRes.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

/**
 * Sets or removes the Webhook for the bot.
 */
export async function setTelegramWebhook(token, webhookUrl) {
  const url = `https://api.telegram.org/bot${token}/setWebhook`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query']
    })
  });

  const resJson = await response.json();
  if (!response.ok || !resJson.ok) {
    throw new Error(`Failed to set Telegram webhook: ${resJson.description || 'Unknown error'}`);
  }
  return resJson;
}
