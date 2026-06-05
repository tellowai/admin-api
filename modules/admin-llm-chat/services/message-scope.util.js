'use strict';

const CONSTANTS = require('../constants/admin-llm-chat.constants');

/** Hints the user is asking about company business / analytics data. */
const BUSINESS_HINTS = /\b(revenue|roas|cpi|cac|ltv|install|signup|conversion|campaign|adset|spend|meta|google|ads|attribution|orders?|payment|retention|funnel|template|credit|analytics|clickhouse|report_date|yesterday|performance|kpi|users?|commerce|purchase|arpu)\b/i;

/** Patterns that are out of scope for this admin tool. */
const OFF_TOPIC_PATTERNS = [
  /\b(tell\s+me\s+)?(a\s+)?(short\s+)?(telugu|hindi|tamil|joke|jokes)\b/i,
  /\b(write|tell|share|give)\s+me\s+(a\s+)?(short\s+)?(story|horror|poem|joke|riddle|recipe)\b/i,
  /\b(horror\s+story|bedtime\s+story|creative\s+writing|fan\s+fiction)\b/i,
  /\b(homework|essay|assignment|solve\s+this\s+math)\b/i,
  /\b(capital\s+of|who\s+is|when\s+was|trivia|fun\s+fact)\b/i,
  /\b(write\s+code|python\s+script|debug\s+my|leetcode)\b/i,
  /\b\d+\s*to\s*\d+\s+in\s+english\b/i,
  /\b(translate\s+this\s+poem|roleplay|pretend\s+you\s+are)\b/i,
];

const REFUSAL_MESSAGE = `I'm limited to ${CONSTANTS.COMPANY_NAME} business analytics — ad spend, campaigns, installs, revenue, orders, and product metrics from our data. Ask something in that scope (e.g. "Meta spend yesterday" or "revenue by currency this month"), and I'll query and answer for you.`;

function evaluateUserMessage(content) {
  const text = String(content || '').trim();
  if (!text) {
    return { refuse: false };
  }
  if (BUSINESS_HINTS.test(text)) {
    return { refuse: false };
  }
  if (OFF_TOPIC_PATTERNS.some((re) => re.test(text))) {
    return { refuse: true, message: REFUSAL_MESSAGE, reason: 'off_topic_pattern' };
  }
  return { refuse: false };
}

module.exports = {
  evaluateUserMessage,
  REFUSAL_MESSAGE,
  BUSINESS_HINTS,
};
