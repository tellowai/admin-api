'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const AttributionAdminService = require('../services/attribution.admin.service');

exports.listTrackingLinks = async function (req, res) {
  try {
    const out = await AttributionAdminService.listTrackingLinks({
      limit: req.query.limit,
      offset: req.query.offset,
      influencer_profile_id: req.query.influencer_profile_id
    });
    return res.status(HTTP_STATUS_CODES.OK).json(out);
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

exports.createTrackingLink = async function (req, res) {
  try {
    const adminId = req.user && req.user.userId;
    const row = await AttributionAdminService.createTrackingLink(req.body, adminId);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ data: row });
  } catch (err) {
    const code = err.statusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    return res.status(code).json({ message: err.message });
  }
};

exports.updateTrackingLink = async function (req, res) {
  try {
    const row = await AttributionAdminService.updateTrackingLink(req.params.id, req.body);
    return res.status(HTTP_STATUS_CODES.OK).json({ data: row });
  } catch (err) {
    const code = err.statusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    return res.status(code).json({ message: err.message });
  }
};

exports.listInfluencers = async function (req, res) {
  try {
    const out = await AttributionAdminService.listInfluencers({
      limit: req.query.limit,
      offset: req.query.offset
    });
    return res.status(HTTP_STATUS_CODES.OK).json(out);
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: err.message });
  }
};

exports.createInfluencer = async function (req, res) {
  try {
    const row = await AttributionAdminService.createInfluencer(req.body);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ data: row });
  } catch (err) {
    const code = err.statusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    return res.status(code).json({ message: err.message });
  }
};

exports.updateInfluencer = async function (req, res) {
  try {
    const row = await AttributionAdminService.updateInfluencer(req.params.id, req.body);
    return res.status(HTTP_STATUS_CODES.OK).json({ data: row });
  } catch (err) {
    const code = err.statusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    return res.status(code).json({ message: err.message });
  }
};

exports.getOverview = async function (req, res) {
  try {
    const out = await AttributionAdminService.getOverview(req.query);
    return res.status(HTTP_STATUS_CODES.OK).json(out);
  } catch (err) {
    const code = err.statusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    return res.status(code).json({ message: err.message });
  }
};

exports.getLinkStats = async function (req, res) {
  try {
    const out = await AttributionAdminService.getLinkStats(req.params.id, req.query);
    return res.status(HTTP_STATUS_CODES.OK).json(out);
  } catch (err) {
    const code = err.statusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    return res.status(code).json({ message: err.message });
  }
};

exports.getInfluencerStats = async function (req, res) {
  try {
    const out = await AttributionAdminService.getProfileStats(req.params.id, req.query);
    return res.status(HTTP_STATUS_CODES.OK).json(out);
  } catch (err) {
    const code = err.statusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    return res.status(code).json({ message: err.message });
  }
};
