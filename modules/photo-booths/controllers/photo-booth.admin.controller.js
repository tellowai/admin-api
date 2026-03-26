'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const PhotoBoothAdminService = require('../services/photo-booth.admin.service');

exports.listBooths = async function (req, res) {
  try {
    const out = await PhotoBoothAdminService.listBooths(req.query || {});
    return res.status(HTTP_STATUS_CODES.OK).json(out);
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.createBooth = async function (req, res) {
  try {
    const booth = await PhotoBoothAdminService.createBooth(req.body || {}, req.user?.userId);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ data: booth });
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.getBooth = async function (req, res) {
  try {
    const detail = await PhotoBoothAdminService.getBoothDetail(req.params.boothId);
    if (!detail) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Photo booth not found' });
    }
    return res.status(HTTP_STATUS_CODES.OK).json({ data: detail });
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.patchBooth = async function (req, res) {
  try {
    const booth = await PhotoBoothAdminService.updateBooth(req.params.boothId, req.body || {});
    if (!booth) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Photo booth not found' });
    }
    return res.status(HTTP_STATUS_CODES.OK).json({ data: booth });
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.archiveBooth = async function (req, res) {
  try {
    await PhotoBoothAdminService.archiveBooth(req.params.boothId);
    return res.status(HTTP_STATUS_CODES.OK).json({ data: { ok: true } });
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.addTemplate = async function (req, res) {
  try {
    const detail = await PhotoBoothAdminService.addTemplate(req.params.boothId, req.body || {});
    return res.status(HTTP_STATUS_CODES.OK).json({ data: detail });
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.patchTemplateLink = async function (req, res) {
  try {
    const detail = await PhotoBoothAdminService.patchTemplateLink(
      req.params.boothId,
      req.params.templateId,
      req.body || {}
    );
    return res.status(HTTP_STATUS_CODES.OK).json({ data: detail });
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.removeTemplate = async function (req, res) {
  try {
    const detail = await PhotoBoothAdminService.removeTemplate(req.params.boothId, req.params.templateId);
    return res.status(HTTP_STATUS_CODES.OK).json({ data: detail });
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.reorderTemplates = async function (req, res) {
  try {
    const detail = await PhotoBoothAdminService.reorderTemplates(
      req.params.boothId,
      req.body.ordered_template_ids
    );
    return res.status(HTTP_STATUS_CODES.OK).json({ data: detail });
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.setDefaultTemplate = async function (req, res) {
  try {
    const detail = await PhotoBoothAdminService.setDefaultTemplate(req.params.boothId, req.params.templateId);
    return res.status(HTTP_STATUS_CODES.OK).json({ data: detail });
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.listGenerations = async function (req, res) {
  try {
    const out = await PhotoBoothAdminService.listGenerations(req.params.boothId, req.query || {});
    return res.status(HTTP_STATUS_CODES.OK).json(out);
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};

exports.getStats = async function (req, res) {
  try {
    const out = await PhotoBoothAdminService.getStats(req.params.boothId);
    return res.status(HTTP_STATUS_CODES.OK).json(out);
  } catch (e) {
    return res.status(e.status || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: e.message });
  }
};
