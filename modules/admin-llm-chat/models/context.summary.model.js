'use strict';

const mysqlModel = require('../../core/models/mysql.promise.model');

exports.create = (data) => {
  const q = `INSERT INTO admin_llm_chat_context_summaries
    (summary_id, conversation_id, summary_text, through_message_id, through_sequence_no,
     summarizer_provider, summarizer_model_id, prompt_tokens, completion_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return mysqlModel.runQueryInMaster(q, [
    data.summary_id,
    data.conversation_id,
    data.summary_text,
    data.through_message_id,
    data.through_sequence_no,
    data.summarizer_provider,
    data.summarizer_model_id,
    data.prompt_tokens || 0,
    data.completion_tokens || 0,
  ]);
};

exports.supersedeForConversation = (conversationId) => {
  const q = `UPDATE admin_llm_chat_context_summaries SET superseded_at = NOW()
    WHERE conversation_id = ? AND superseded_at IS NULL`;
  return mysqlModel.runQueryInMaster(q, [conversationId]);
};

exports.getLatest = (conversationId) => {
  const q = `SELECT summary_id, conversation_id, summary_text, through_message_id, through_sequence_no,
    summarizer_provider, summarizer_model_id, prompt_tokens, completion_tokens, created_at
    FROM admin_llm_chat_context_summaries
    WHERE conversation_id = ? AND superseded_at IS NULL
    ORDER BY created_at DESC LIMIT 1`;
  return mysqlModel.runQueryInSlave(q, [conversationId]).then((rows) => rows[0] || null);
};

exports.listForConversation = (conversationId) => {
  const q = `SELECT summary_id, summary_text, through_sequence_no, summarizer_provider, summarizer_model_id, created_at
    FROM admin_llm_chat_context_summaries
    WHERE conversation_id = ?
    ORDER BY created_at DESC LIMIT 5`;
  return mysqlModel.runQueryInSlave(q, [conversationId]);
};
