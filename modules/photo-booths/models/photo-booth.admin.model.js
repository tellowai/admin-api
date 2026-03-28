'use strict';

const moment = require('moment');
const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

function formatDateForMySQL(date) {
  if (!date) return null;
  const m = moment(date);
  return m.isValid() ? m.format('YYYY-MM-DD HH:mm:ss') : null;
}

exports.listBooths = async function ({ status, q, limit, offset }) {
  let sql = `
    SELECT *
    FROM photo_booths
    WHERE archived_at IS NULL
  `;
  const params = [];
  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  if (q && String(q).trim()) {
    sql += ` AND (booth_name LIKE ? OR booth_code LIKE ? OR photo_booth_id LIKE ?)`;
    const like = `%${String(q).trim()}%`;
    params.push(like, like, like);
  }
  sql += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit) || 20, Number(offset) || 0);
  return await mysqlQueryRunner.runQueryInSlave(sql, params);
};

exports.getBoothById = async function (photoBoothId) {
  const sql = `
    SELECT * FROM photo_booths
    WHERE photo_booth_id = ? AND archived_at IS NULL
    LIMIT 1
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(sql, [photoBoothId]);
  return rows && rows[0] ? rows[0] : null;
};

exports.insertBooth = async function (row) {
  const sql = `
    INSERT INTO photo_booths (
      photo_booth_id, booth_name, booth_code, description, status,
      booth_cover_image_bucket, booth_cover_image_key, camera_layout, camera_pipeline,
      camera_panel_orientation, camera_panel_x, camera_panel_y,
      max_generations_per_device, rate_limit_window_minutes,
      location_name, event_name, starts_at, ends_at, additional_data, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    row.photo_booth_id,
    row.booth_name,
    row.booth_code,
    row.description ?? null,
    row.status || 'inactive',
    row.booth_cover_image_bucket ?? null,
    row.booth_cover_image_key ?? null,
    row.camera_layout || 'side_by_side',
    row.camera_pipeline || 'normal',
    row.camera_panel_orientation ?? 'landscape',
    row.camera_panel_x ?? 0.5,
    row.camera_panel_y ?? 0.5,
    row.max_generations_per_device ?? 5,
    row.rate_limit_window_minutes ?? 60,
    row.location_name ?? null,
    row.event_name ?? null,
    row.starts_at ?? null,
    row.ends_at ?? null,
    row.additional_data ? JSON.stringify(row.additional_data) : null,
    row.created_by ?? null
  ];
  await mysqlQueryRunner.runQueryInMaster(sql, params);
  return row.photo_booth_id;
};

exports.updateBooth = async function (photoBoothId, patch) {
  const allowed = [
    'booth_name', 'booth_code', 'description', 'status',
    'booth_cover_image_bucket', 'booth_cover_image_key', 'camera_layout', 'camera_pipeline',
    'camera_panel_orientation', 'camera_panel_x', 'camera_panel_y',
    'max_generations_per_device', 'rate_limit_window_minutes',
    'location_name', 'event_name', 'starts_at', 'ends_at', 'additional_data'
  ];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      sets.push(`${key} = ?`);
      let v = patch[key];
      if (key === 'additional_data' && v != null && typeof v === 'object') {
        v = JSON.stringify(v);
      }
      params.push(v);
    }
  }
  if (!sets.length) return 0;
  params.push(photoBoothId);
  const sql = `UPDATE photo_booths SET ${sets.join(', ')} WHERE photo_booth_id = ? AND archived_at IS NULL`;
  const res = await mysqlQueryRunner.runQueryInMaster(sql, params);
  return res && res.affectedRows != null ? res.affectedRows : 0;
};

exports.archiveBooth = async function (photoBoothId) {
  const sql = `
    UPDATE photo_booths
    SET archived_at = CURRENT_TIMESTAMP(3), status = 'archived', updated_at = CURRENT_TIMESTAMP(3)
    WHERE photo_booth_id = ? AND archived_at IS NULL
  `;
  await mysqlQueryRunner.runQueryInMaster(sql, [photoBoothId]);
};

exports.listTemplateLinks = async function (photoBoothId) {
  const sql = `
    SELECT photo_booth_template_id, template_id, sort_order, is_default, preview_orientation,
           camera_pipeline, camera_panel_orientation, camera_panel_x, camera_panel_y
    FROM photo_booth_templates
    WHERE photo_booth_id = ? AND archived_at IS NULL
    ORDER BY sort_order ASC, photo_booth_template_id ASC
  `;
  return await mysqlQueryRunner.runQueryInSlave(sql, [photoBoothId]);
};

exports.insertTemplateLink = async function ({
  photo_booth_id,
  template_id,
  sort_order,
  is_default,
  preview_orientation,
  camera_pipeline,
  camera_panel_orientation,
  camera_panel_x,
  camera_panel_y
}) {
  const sql = `
    INSERT INTO photo_booth_templates (
      photo_booth_id, template_id, sort_order, is_default, preview_orientation,
      camera_pipeline, camera_panel_orientation, camera_panel_x, camera_panel_y
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE archived_at = NULL, sort_order = VALUES(sort_order), is_default = VALUES(is_default)
  `;
  await mysqlQueryRunner.runQueryInMaster(sql, [
    photo_booth_id,
    template_id,
    sort_order ?? 0,
    is_default ? 1 : 0,
    preview_orientation || 'portrait',
    camera_pipeline || 'normal',
    camera_panel_orientation ?? 'landscape',
    camera_panel_x ?? 0.5,
    camera_panel_y ?? 0.5
  ]);
};

exports.patchTemplateLinkRow = async function (photoBoothId, templateId, patch) {
  const allowed = [
    'preview_orientation',
    'camera_pipeline',
    'camera_panel_orientation',
    'camera_panel_x',
    'camera_panel_y'
  ];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      sets.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }
  if (!sets.length) return 0;
  params.push(photoBoothId, templateId);
  const sql = `
    UPDATE photo_booth_templates
    SET ${sets.join(', ')}
    WHERE photo_booth_id = ? AND template_id = ? AND archived_at IS NULL
  `;
  const res = await mysqlQueryRunner.runQueryInMaster(sql, params);
  return res && res.affectedRows != null ? res.affectedRows : 0;
};

exports.archiveTemplateLink = async function (photoBoothId, templateId) {
  const sql = `
    UPDATE photo_booth_templates
    SET archived_at = CURRENT_TIMESTAMP(3)
    WHERE photo_booth_id = ? AND template_id = ? AND archived_at IS NULL
  `;
  await mysqlQueryRunner.runQueryInMaster(sql, [photoBoothId, templateId]);
};

exports.clearDefaultTemplates = async function (photoBoothId) {
  const sql = `
    UPDATE photo_booth_templates SET is_default = 0
    WHERE photo_booth_id = ? AND archived_at IS NULL
  `;
  await mysqlQueryRunner.runQueryInMaster(sql, [photoBoothId]);
};

exports.setDefaultTemplate = async function (photoBoothId, templateId) {
  const sql = `
    UPDATE photo_booth_templates SET is_default = 1
    WHERE photo_booth_id = ? AND template_id = ? AND archived_at IS NULL
  `;
  await mysqlQueryRunner.runQueryInMaster(sql, [photoBoothId, templateId]);
};

exports.updateTemplateSortBatch = async function (photoBoothId, templateIdToOrder) {
  if (!templateIdToOrder || templateIdToOrder.size === 0) return;
  const ids = [...templateIdToOrder.keys()];
  const caseParts = [];
  const params = [];
  for (const tid of ids) {
    caseParts.push('WHEN ? THEN ?');
    params.push(tid, templateIdToOrder.get(tid));
  }
  const inPh = ids.map(() => '?').join(',');
  params.push(photoBoothId, ...ids);
  const sql = `
    UPDATE photo_booth_templates
    SET sort_order = CASE template_id ${caseParts.join(' ')} END
    WHERE photo_booth_id = ?
    AND archived_at IS NULL
    AND template_id IN (${inPh})
  `;
  await mysqlQueryRunner.runQueryInMaster(sql, params);
};

function mysqlJobStatusMatchesFilter(mgJobStatus, filter) {
  if (!filter) return true;
  if (filter === 'completed') return mgJobStatus === 'completed';
  if (filter === 'failed') return mgJobStatus === 'failed' || mgJobStatus === 'cancelled';
  return true;
}

/**
 * Single-table page from photo_booth_generations (no joins).
 */
async function listPbgIdsPage({ photoBoothId, startFormatted, endFormatted, templateId, limit, offset }) {
  let sql = `
    SELECT media_generation_id
    FROM photo_booth_generations
    WHERE photo_booth_id = ? AND created_at >= ? AND created_at <= ?
  `;
  const params = [photoBoothId, startFormatted, endFormatted];
  if (templateId) {
    sql += ` AND template_id = ?`;
    params.push(templateId);
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit) || 10, Number(offset) || 0);
  return await mysqlQueryRunner.runQueryInSlave(sql, params);
}

/**
 * Paginate booth generations by MySQL created_at (guest session time), ordered newest first.
 * When jobStatus is set: scan pbg in batches, load job_status via simple IN (?) on media_generations, filter in memory (no JOIN).
 */
exports.listMediaGenerationIdsInDateRange = async function ({
  photoBoothId,
  startDate,
  endDate,
  templateId,
  jobStatus,
  limit,
  offset
}) {
  const startFormatted = formatDateForMySQL(startDate);
  const endFormatted = formatDateForMySQL(endDate);
  if (!startFormatted || !endFormatted) {
    return [];
  }

  const lim = Number(limit) || 10;
  const off = Number(offset) || 0;

  if (!jobStatus) {
    return listPbgIdsPage({
      photoBoothId,
      startFormatted,
      endFormatted,
      templateId,
      limit: lim,
      offset: off
    });
  }

  const needCount = off + lim;
  const matched = [];
  const batchSize = 200;
  const maxRowsScanned = 10000;
  let scanOffset = 0;

  while (matched.length < needCount && scanOffset < maxRowsScanned) {
    const batch = await listPbgIdsPage({
      photoBoothId,
      startFormatted,
      endFormatted,
      templateId,
      limit: batchSize,
      offset: scanOffset
    });
    if (!batch.length) break;

    const ids = batch.map((r) => r.media_generation_id).filter(Boolean);
    const statusRows = await exports.getMediaGenerationJobStatusByIds(ids);
    const statusById = new Map(statusRows.map((r) => [r.media_generation_id, r.job_status]));

    for (const row of batch) {
      const id = row.media_generation_id;
      if (!id) continue;
      const st = statusById.get(id);
      if (!mysqlJobStatusMatchesFilter(st, jobStatus)) continue;
      matched.push({ media_generation_id: id });
    }

    scanOffset += batch.length;
    if (batch.length < batchSize) break;
  }

  return matched.slice(off, off + lim);
};

exports.listGenerations = async function ({ photoBoothId, templateId, from, to, limit, offset }) {
  let sql = `
    SELECT photo_booth_generation_id, photo_booth_id, media_generation_id, template_id, device_id,
           user_photo_bucket, user_photo_key, output_photo_bucket, output_photo_key, created_at
    FROM photo_booth_generations
    WHERE photo_booth_id = ?
  `;
  const params = [photoBoothId];
  if (templateId) {
    sql += ` AND template_id = ?`;
    params.push(templateId);
  }
  if (from) {
    sql += ` AND created_at >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND created_at <= ?`;
    params.push(to);
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit) || 30, Number(offset) || 0);
  return await mysqlQueryRunner.runQueryInSlave(sql, params);
};

/** Single aggregate for admin dashboard (not list pagination). */
exports.countGenerationsSince = async function (photoBoothId, sinceDate) {
  const sql = `
    SELECT COUNT(*) AS cnt
    FROM photo_booth_generations
    WHERE photo_booth_id = ?
    AND created_at >= ?
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(sql, [photoBoothId, sinceDate]);
  return rows && rows[0] ? Number(rows[0].cnt) : 0;
};

exports.getMediaGenerationJobStatusByIds = async function (mediaGenerationIds) {
  if (!mediaGenerationIds || !mediaGenerationIds.length) return [];
  const ph = mediaGenerationIds.map(() => '?').join(',');
  const sql = `
    SELECT media_generation_id, job_status, execution_status, error_message
    FROM media_generations
    WHERE media_generation_id IN (${ph})
  `;
  return await mysqlQueryRunner.runQueryInSlave(sql, mediaGenerationIds);
};

exports.boothCodeExists = async function (boothCode, excludeBoothId) {
  let sql = `
    SELECT photo_booth_id FROM photo_booths
    WHERE UPPER(TRIM(booth_code)) = UPPER(?) AND archived_at IS NULL
    LIMIT 1
  `;
  const params = [String(boothCode).trim()];
  if (excludeBoothId) {
    sql = `
      SELECT photo_booth_id FROM photo_booths
      WHERE UPPER(TRIM(booth_code)) = UPPER(?) AND archived_at IS NULL AND photo_booth_id <> ?
      LIMIT 1
    `;
    params.push(excludeBoothId);
  }
  const rows = await mysqlQueryRunner.runQueryInSlave(sql, params);
  return !!(rows && rows[0]);
};
