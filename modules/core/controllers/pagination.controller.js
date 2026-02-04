'use strict';

/**
 * Default pagination values
 */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * Process pagination parameters from request query.
 * Page-based: page=1,2,3 and page_size (or limit, per_page) for items per page.
 * Existing callers using query.limit are unchanged; new callers can use query.page_size.
 * @param {Object} query - Request query object (supports page, page_size, limit, per_page)
 * @returns {Object} Processed pagination parameters { page, limit, offset }
 */
exports.getPaginationParams = function(query) {
  const page = Math.max(parseInt(query.page, 10) || DEFAULT_PAGE, 1);

  // Prefer limit (existing usage), then page_size, then per_page; fallback DEFAULT_LIMIT
  const limitFromQuery = parseInt(query.limit, 10) || parseInt(query.page_size, 10) || parseInt(query.per_page, 10) || DEFAULT_LIMIT;
  let limit = Math.min(Math.max(limitFromQuery, 1), MAX_LIMIT);

  const offset = (page - 1) * limit;

  return {
    page,
    limit,
    offset
  };
};

/**
 * Format pagination response
 * @param {Array} data - Data array
 * @param {number} total - Total number of records
 * @param {Object} params - Pagination parameters
 * @returns {Object} Formatted response with data and pagination info
 */
exports.formatPaginationResponse = function(data, total, params) {
  const { page, limit } = params;
  const totalPages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      total,
      total_pages: totalPages,
      current_page: page,
      per_page: limit,
      has_next: page < totalPages,
      has_previous: page > 1
    }
  };
}; 