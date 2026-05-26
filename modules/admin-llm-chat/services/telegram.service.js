'use strict';

const axios = require('axios');
const config = require('../../../config/config');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Telegram Bot API HTML mode: <b>, <i>, etc. (not ** markdown).
 * LLM digest output uses **section** — convert before send.
 */
function formatForTelegramHtml(text) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/__([^_\n]+)__/g, '<b>$1</b>');
  return s;
}

/** @deprecated Telegram MarkdownV2 uses *bold*, not **. Prefer formatForTelegramHtml. */
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
        text: formatForTelegramHtml(chunk),
        parse_mode: 'HTML',
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

module.exports = {
  sendMessage,
  formatForTelegramHtml,
  escapeHtml,
  escapeMarkdownV2,
};
