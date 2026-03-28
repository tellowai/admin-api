'use strict';

const { v4: uuidv4 } = require('uuid');
const BoothAdminModel = require('../models/photo-booth.admin.model');
const TemplateModel = require('../../templates/models/template.model');
const {
  generateHumanFriendlyBoothCode,
  normalizeBoothCode,
  isValidBoothCode
} = require('../lib/generate-booth-code');
const AttributionAdminService = require('../../attribution/services/attribution.admin.service');

const CAMERA_PIPELINES = new Set(['normal', 'segmented']);
const PREVIEW_ORIENTATIONS = new Set(['portrait', 'landscape']);
const CAMERA_PANEL_ORIENTATIONS = new Set(['portrait', 'landscape']);

function normalizeCameraPipeline(raw) {
  if (raw == null || raw === '') return 'normal';
  const v = String(raw).trim().toLowerCase();
  if (CAMERA_PIPELINES.has(v)) return v;
  const err = new Error('camera_pipeline must be "normal" or "segmented"');
  err.status = 400;
  throw err;
}

function normalizePreviewOrientation(raw) {
  if (raw == null || raw === '') return 'portrait';
  const v = String(raw).trim().toLowerCase();
  if (PREVIEW_ORIENTATIONS.has(v)) return v;
  const err = new Error('preview_orientation must be "portrait" or "landscape"');
  err.status = 400;
  throw err;
}

function normalizeCameraPanelOrientation(raw) {
  if (raw == null || raw === '') return 'landscape';
  const v = String(raw).trim().toLowerCase();
  if (CAMERA_PANEL_ORIENTATIONS.has(v)) return v;
  const err = new Error('camera_panel_orientation must be "portrait" or "landscape"');
  err.status = 400;
  throw err;
}

function normalizeCameraPanelCoord(raw) {
  if (raw == null || raw === '') return 0.5;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    const err = new Error('camera_panel_x and camera_panel_y must be numbers between 0 and 1');
    err.status = 400;
    throw err;
  }
  if (n < 0 || n > 1) {
    const err = new Error('camera_panel_x and camera_panel_y must be between 0 and 1');
    err.status = 400;
    throw err;
  }
  return n;
}

function stitchTemplates(links, templateRows) {
  const byId = new Map();
  for (const t of templateRows || []) {
    if (!byId.has(t.template_id)) byId.set(t.template_id, t);
  }
  return links.map((link) => {
    const t = byId.get(link.template_id);
    return {
      template_id: link.template_id,
      sort_order: link.sort_order,
      is_default: !!link.is_default,
      preview_orientation: link.preview_orientation === 'landscape' ? 'landscape' : 'portrait',
      camera_pipeline: link.camera_pipeline === 'segmented' ? 'segmented' : 'normal',
      camera_panel_orientation: link.camera_panel_orientation === 'portrait' ? 'portrait' : 'landscape',
      camera_panel_x: link.camera_panel_x != null ? Number(link.camera_panel_x) : 0.5,
      camera_panel_y: link.camera_panel_y != null ? Number(link.camera_panel_y) : 0.5,
      template_name: t ? t.template_name : null,
      template_code: t ? t.template_code : null,
      cf_r2_url: t ? t.cf_r2_url : null
    };
  });
}

exports.listBooths = async function (query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const rows = await BoothAdminModel.listBooths({
    status: query.status || null,
    q: query.q || null,
    limit,
    offset
  });
  return { data: rows };
};

exports.createBooth = async function (body, adminUserId) {
  const requestedCustom =
    body.booth_code != null && String(body.booth_code).trim() !== '';
  let code = normalizeBoothCode(body.booth_code);
  if (requestedCustom && !code) {
    const err = new Error(
      'Invalid booth code: use format AAAA-BBB-CCC (4+3+3 characters, letters A–Z except I and O, digits 2–9, hyphens).'
    );
    err.status = 400;
    throw err;
  }
  if (!code) {
    const maxAttempts = 20;
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      code = generateHumanFriendlyBoothCode();
      if (!(await BoothAdminModel.boothCodeExists(code))) break;
    }
    if (await BoothAdminModel.boothCodeExists(code)) {
      const err = new Error('Could not allocate a unique booth code; try again');
      err.status = 503;
      throw err;
    }
  } else {
    if (!isValidBoothCode(code)) {
      const err = new Error(
        'Invalid booth code: use format AAAA-BBB-CCC (4+3+3 characters, letters A–Z except I and O, digits 2–9, hyphens).'
      );
      err.status = 400;
      throw err;
    }
    code = normalizeBoothCode(code);
    if (await BoothAdminModel.boothCodeExists(code)) {
      const err = new Error('This booth code is already in use');
      err.status = 409;
      throw err;
    }
  }
  const id = uuidv4();
  await BoothAdminModel.insertBooth({
    photo_booth_id: id,
    booth_name: String(body.booth_name || '').trim() || 'Untitled booth',
    booth_code: code,
    description: body.description,
    status: body.status || 'inactive',
    booth_cover_image_bucket: body.booth_cover_image_bucket,
    booth_cover_image_key: body.booth_cover_image_key,
    camera_layout: body.camera_layout,
    camera_pipeline: normalizeCameraPipeline(body.camera_pipeline),
    camera_panel_orientation: normalizeCameraPanelOrientation(body.camera_panel_orientation),
    camera_panel_x: normalizeCameraPanelCoord(body.camera_panel_x),
    camera_panel_y: normalizeCameraPanelCoord(body.camera_panel_y),
    max_generations_per_device: body.max_generations_per_device,
    rate_limit_window_minutes: body.rate_limit_window_minutes,
    location_name: body.location_name,
    event_name: body.event_name,
    starts_at: body.starts_at,
    ends_at: body.ends_at,
    additional_data: body.additional_data,
    created_by: adminUserId || null
  });
  return BoothAdminModel.getBoothById(id);
};

exports.getBoothDetail = async function (photoBoothId) {
  const booth = await BoothAdminModel.getBoothById(photoBoothId);
  if (!booth) return null;
  const links = await BoothAdminModel.listTemplateLinks(photoBoothId);
  const ids = [...new Set(links.map((l) => l.template_id))];
  const templates = ids.length ? await TemplateModel.getTemplatesByIdsForAnalytics(ids) : [];
  return { booth, templates: stitchTemplates(links, templates) };
};

exports.updateBooth = async function (photoBoothId, body) {
  body = { ...body };
  if (Object.prototype.hasOwnProperty.call(body, 'camera_pipeline')) {
    body.camera_pipeline = normalizeCameraPipeline(body.camera_pipeline);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'camera_panel_orientation')) {
    body.camera_panel_orientation = normalizeCameraPanelOrientation(body.camera_panel_orientation);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'camera_panel_x')) {
    body.camera_panel_x = normalizeCameraPanelCoord(body.camera_panel_x);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'camera_panel_y')) {
    body.camera_panel_y = normalizeCameraPanelCoord(body.camera_panel_y);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'booth_code')) {
    const err = new Error('booth_code cannot be changed after the booth is created');
    err.status = 400;
    throw err;
  }
  await BoothAdminModel.updateBooth(photoBoothId, body);
  return BoothAdminModel.getBoothById(photoBoothId);
};

exports.archiveBooth = async function (photoBoothId) {
  await BoothAdminModel.archiveBooth(photoBoothId);
};

exports.addTemplate = async function (photoBoothId, body) {
  const { template_id, sort_order, is_default } = body || {};
  const preview_orientation = normalizePreviewOrientation(body?.preview_orientation);
  const tpl = await TemplateModel.getTemplateById(template_id);
  if (!tpl) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }
  if (is_default) {
    await BoothAdminModel.clearDefaultTemplates(photoBoothId);
  }
  const links = await BoothAdminModel.listTemplateLinks(photoBoothId);
  const nextOrder = sort_order != null ? sort_order : links.length;
  const camera_pipeline = normalizeCameraPipeline(body?.camera_pipeline);
  const camera_panel_orientation = normalizeCameraPanelOrientation(body?.camera_panel_orientation);
  const camera_panel_x = normalizeCameraPanelCoord(body?.camera_panel_x);
  const camera_panel_y = normalizeCameraPanelCoord(body?.camera_panel_y);
  await BoothAdminModel.insertTemplateLink({
    photo_booth_id: photoBoothId,
    template_id,
    sort_order: nextOrder,
    is_default: !!is_default,
    preview_orientation,
    camera_pipeline,
    camera_panel_orientation,
    camera_panel_x,
    camera_panel_y
  });
  return exports.getBoothDetail(photoBoothId);
};

exports.patchTemplateLink = async function (photoBoothId, templateId, body) {
  body = body || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'preview_orientation')) {
    patch.preview_orientation = normalizePreviewOrientation(body.preview_orientation);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'camera_pipeline')) {
    patch.camera_pipeline = normalizeCameraPipeline(body.camera_pipeline);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'camera_panel_orientation')) {
    patch.camera_panel_orientation = normalizeCameraPanelOrientation(body.camera_panel_orientation);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'camera_panel_x')) {
    patch.camera_panel_x = normalizeCameraPanelCoord(body.camera_panel_x);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'camera_panel_y')) {
    patch.camera_panel_y = normalizeCameraPanelCoord(body.camera_panel_y);
  }
  if (!Object.keys(patch).length) {
    const err = new Error(
      'At least one field required: preview_orientation, camera_pipeline, camera_panel_orientation, camera_panel_x, camera_panel_y'
    );
    err.status = 400;
    throw err;
  }
  const n = await BoothAdminModel.patchTemplateLinkRow(photoBoothId, templateId, patch);
  if (!n) {
    const err = new Error('Template link not found');
    err.status = 404;
    throw err;
  }
  return exports.getBoothDetail(photoBoothId);
};

exports.removeTemplate = async function (photoBoothId, templateId) {
  await BoothAdminModel.archiveTemplateLink(photoBoothId, templateId);
  return exports.getBoothDetail(photoBoothId);
};

exports.reorderTemplates = async function (photoBoothId, orderedTemplateIds) {
  if (!Array.isArray(orderedTemplateIds) || !orderedTemplateIds.length) {
    const err = new Error('ordered_template_ids must be a non-empty array');
    err.status = 400;
    throw err;
  }
  const m = new Map();
  orderedTemplateIds.forEach((tid, i) => m.set(String(tid), i));
  await BoothAdminModel.updateTemplateSortBatch(photoBoothId, m);
  return exports.getBoothDetail(photoBoothId);
};

exports.setDefaultTemplate = async function (photoBoothId, templateId) {
  await BoothAdminModel.clearDefaultTemplates(photoBoothId);
  await BoothAdminModel.setDefaultTemplate(photoBoothId, templateId);
  return exports.getBoothDetail(photoBoothId);
};

exports.listGenerations = async function (photoBoothId, query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 30));
  const offset = (page - 1) * limit;
  const rows = await BoothAdminModel.listGenerations({
    photoBoothId,
    templateId: query.template_id || null,
    from: query.from || null,
    to: query.to || null,
    limit,
    offset
  });
  const tids = [...new Set(rows.map((r) => r.template_id))];
  const templates = tids.length ? await TemplateModel.getTemplatesByIdsForAnalytics(tids) : [];
  const tmap = new Map(templates.map((t) => [t.template_id, t.template_name]));
  const mgIds = rows.map((r) => r.media_generation_id);
  const statuses = await BoothAdminModel.getMediaGenerationJobStatusByIds(mgIds);
  const smap = new Map(statuses.map((s) => [s.media_generation_id, s]));
  const data = rows.map((r) => ({
    ...r,
    template_name: tmap.get(r.template_id) || null,
    job_status: smap.get(r.media_generation_id)?.job_status || null,
    execution_status: smap.get(r.media_generation_id)?.execution_status || null,
    error_message: smap.get(r.media_generation_id)?.error_message || null
  }));
  return { data };
};

exports.getStats = async function (photoBoothId) {
  const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const d1 = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [c7, c24] = await Promise.all([
    BoothAdminModel.countGenerationsSince(photoBoothId, d7),
    BoothAdminModel.countGenerationsSince(photoBoothId, d1)
  ]);
  return { data: { generations_last_7d: c7, generations_last_24h: c24 } };
};

exports.getPhotoboothShareLink = async function (photoBoothId) {
  const booth = await BoothAdminModel.getBoothById(photoBoothId);
  if (!booth) {
    const err = new Error('Photo booth not found');
    err.status = 404;
    throw err;
  }
  const link = await AttributionAdminService.getLatestPhotoboothShareLink(photoBoothId);
  return { link };
};

exports.generatePhotoboothShareLink = async function (photoBoothId, adminUserId, body = {}) {
  const booth = await BoothAdminModel.getBoothById(photoBoothId);
  if (!booth) {
    const err = new Error('Photo booth not found');
    err.status = 404;
    throw err;
  }
  const slLanding = body.sl_landing === 'website_only' ? 'website_only' : 'app_install';
  const link = await AttributionAdminService.createPhotoboothAdminShareLink(
    {
      photo_booth_id: booth.photo_booth_id,
      booth_code: booth.booth_code,
      booth_name: booth.booth_name
    },
    adminUserId,
    { sl_landing: slLanding }
  );
  return { link };
};

exports.patchPhotoboothShareLink = async function (photoBoothId, body = {}) {
  const booth = await BoothAdminModel.getBoothById(photoBoothId);
  if (!booth) {
    const err = new Error('Photo booth not found');
    err.status = 404;
    throw err;
  }
  if (body.sl_landing === undefined || body.sl_landing === null) {
    const err = new Error('sl_landing is required');
    err.status = 400;
    throw err;
  }
  const link = await AttributionAdminService.updatePhotoboothShareLinkSlLanding(
    photoBoothId,
    body.sl_landing
  );
  return { link };
};
