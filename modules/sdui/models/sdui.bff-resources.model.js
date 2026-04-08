'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v4: uuidv4 } = require('uuid');

exports.listBffResources = async function() {
  const query = `
    SELECT * FROM sdui_bff_resources
    WHERE is_active = 1
    ORDER BY display_name ASC
  `;
  return mysqlQueryRunner.runQueryInSlave(query, []);
};

exports.createBffResource = async function(data) {
  const id = uuidv4();
  const sampleJson =
    data.sample_payload_json === undefined || data.sample_payload_json === null || data.sample_payload_json === ''
      ? null
      : typeof data.sample_payload_json === 'string'
        ? data.sample_payload_json
        : JSON.stringify(data.sample_payload_json);

  const query = `
    INSERT INTO sdui_bff_resources 
    (id, resource_key, display_name, description, api_url, http_method, sample_payload_json,
     use_sample_when_empty, use_sample_on_error,
     domain_service, service_method, requires_auth, is_paginated, default_page_size, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    id,
    data.resource_key,
    data.display_name,
    data.description || null,
    data.api_url || null,
    (data.http_method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
    sampleJson,
    data.use_sample_when_empty !== false ? 1 : 0,
    data.use_sample_on_error ? 1 : 0,
    data.domain_service || null,
    data.service_method || null,
    data.requires_auth !== false ? 1 : 0,
    data.is_paginated ? 1 : 0,
    data.default_page_size || 20,
    data.is_active !== false ? 1 : 0
  ];

  await mysqlQueryRunner.runQueryInMaster(query, params);
  return id;
};

exports.updateBffResource = async function(id, data) {
  const updates = [];
  const params = [];

  const updateableFields = [
    'resource_key',
    'display_name',
    'description',
    'api_url',
    'http_method',
    'sample_payload_json',
    'use_sample_when_empty',
    'use_sample_on_error',
    'domain_service',
    'service_method',
    'requires_auth',
    'is_paginated',
    'default_page_size',
    'is_active'
  ];

  updateableFields.forEach(field => {
    if (data[field] !== undefined) {
      if (field === 'sample_payload_json') {
        const v = data[field];
        const normalized =
          v === null || v === ''
            ? null
            : typeof v === 'string'
              ? v
              : JSON.stringify(v);
        updates.push(`${field} = ?`);
        params.push(normalized);
        return;
      }
      if (field === 'http_method') {
        updates.push(`${field} = ?`);
        params.push(String(data[field]).toUpperCase() === 'POST' ? 'POST' : 'GET');
        return;
      }
      updates.push(`${field} = ?`);
      if (['requires_auth', 'is_paginated', 'is_active', 'use_sample_when_empty', 'use_sample_on_error'].includes(field)) {
        params.push(data[field] ? 1 : 0);
      } else {
        params.push(data[field]);
      }
    }
  });

  if (updates.length === 0) return false;

  const query = `UPDATE sdui_bff_resources SET ${updates.join(', ')} WHERE id = ?`;
  params.push(id);

  const result = await mysqlQueryRunner.runQueryInMaster(query, params);
  return result.affectedRows > 0;
};

exports.deleteBffResource = async function(id) {
  const query = `UPDATE sdui_bff_resources SET is_active = 0 WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInMaster(query, [id]);
  return result.affectedRows > 0;
};
