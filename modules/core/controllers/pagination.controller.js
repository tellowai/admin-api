'use strict';

/**
 * Default pagination values
 */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * Process pagination parameters from request query
 * @param {Object} query - Request query object
 * @returns {Object} Processed pagination parameters
 */
exports.getPaginationParams = function(query) {
  const page = Math.max(parseInt(query.page) || DEFAULT_PAGE, 1);
  let limit = parseInt(query.limit) || DEFAULT_LIMIT;
  
  // Ensure limit doesn't exceed maximum
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);
  
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