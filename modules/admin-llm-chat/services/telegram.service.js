'use strict';

const axios = require('axios');
const config = require('../../../config/config');

function escapeMarkdownV2(text) {
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function sendMessage(text, chatId) {
  const token = config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const ids = chatId ? [chatId] : (config.telegram?.chatIds || []).filter(Boolean);
  if (!token || !ids.length) {
    throw new Error('Telegram not configured');
  }
  const chunks = splitMessage(text, 4000);
  const results = [];
  for (const cid of ids) {
    for (const chunk of chunks) {
      const body = {
        chat_id: cid,
        text: escapeMarkdownV2(chunk),
        parse_mode: 'MarkdownV2',
      };
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const { data } = await axios.post(url, body);
      results.push(data);
    }
  }
  return results;
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > maxLen) {
    let idx = rest.lastIndexOf('\n\n', maxLen);
    if (idx < maxLen / 2) idx = maxLen;
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx);
  }
  if (rest) parts.push(rest);
  return parts;
}

module.exports = { sendMessage, escapeMarkdownV2 };
