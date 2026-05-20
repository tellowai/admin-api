'use strict';

const mysqlModel = require('../../core/models/mysql.promise.model');

exports.incrementDaily = (userId, { tokensIn, tokensOut, costUsd, messages = 0, toolCalls = 0 }) => {
  const q = `INSERT INTO admin_llm_chat_usage_daily
    (usage_id, user_id, usage_date, tokens_in, tokens_out, cost_usd, message_count, tool_call_count)
    VALUES (UUID(), ?, CURDATE(), ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      tokens_in = tokens_in + VALUES(tokens_in),
      tokens_out = tokens_out + VALUES(tokens_out),
      cost_usd = cost_usd + VALUES(cost_usd),
      message_count = message_count + VALUES(message_count),
      tool_call_count = tool_call_count + VALUES(tool_call_count),
      updated_at = NOW()`;
  return mysqlModel.runQueryInMaster(q, [userId, tokensIn, tokensOut, costUsd, messages, toolCalls]);
};

exports.getDailyForUser = (userId) => {
  const q = `SELECT tokens_in, tokens_out, cost_usd FROM admin_llm_chat_usage_daily
    WHERE user_id = ? AND usage_date = CURDATE() LIMIT 1`;
  return mysqlModel.runQueryInSlave(q, [userId]).then((r) => r[0] || { tokens_in: 0, tokens_out: 0, cost_usd: 0 });
};
