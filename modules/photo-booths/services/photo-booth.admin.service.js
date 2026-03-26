'use strict';

const { v4: uuidv4 } = require('uuid');
const BoothAdminModel = require('../models/photo-booth.admin.model');
const TemplateModel = require('../../templates/models/template.model');
const {
  generateHumanFriendlyBoothCode,
  normalizeBoothCode,
  isValidBoothCode
} = require('../lib/generate-booth-code');

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
  if (body.booth_code != null) {
    const code = normalizeBoothCode(body.booth_code);
    if (!code) {
      const err = new Error('booth_code cannot be empty');
      err.status = 400;
      throw err;
    }
    if (!isValidBoothCode(code)) {
      const err = new Error(
        'Invalid booth code: use format AAAA-BBB-CCC (4+3+3 characters, letters A–Z except I and O, digits 2–9, hyphens).'
      );
      err.status = 400;
      throw err;
    }
    if (await BoothAdminModel.boothCodeExists(code, photoBoothId)) {
      const err = new Error('This booth code is already in use');
      err.status = 409;
      throw err;
    }
    body = { ...body, booth_code: code };
  }
  await BoothAdminModel.updateBooth(photoBoothId, body);
  return BoothAdminModel.getBoothById(photoBoothId);
};

exports.archiveBooth = async function (photoBoothId) {
  await BoothAdminModel.archiveBooth(photoBoothId);
};

exports.addTemplate = async function (photoBoothId, { template_id, sort_order, is_default }) {
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
  await BoothAdminModel.insertTemplateLink({
    photo_booth_id: photoBoothId,
    template_id,
    sort_order: nextOrder,
    is_default: !!is_default
  });
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
