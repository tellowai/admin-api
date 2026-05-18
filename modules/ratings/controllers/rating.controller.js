'use strict';

const RatingService = require('../services/rating.service');

/**
 * GET /admin/ratings
 * Query: page, limit, start_date, end_date, tz, platform
 * Default date range: last 7 days (including today).
 */
exports.listRatings = async function (req, res) {
  try {
    const result = await RatingService.listRatings(req.query);
    return res.status(200).send(result);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).send({ message: err.message });
    }
    console.error('List ratings error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};
