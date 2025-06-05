'use strict';

// Storage for in-memory tracking of generation requests (temporary solution)
const requestsCache = new Map();

/**
 * Create a new generation request
 */
exports.createGenerationRequest = async (requestData) => {
  // Store in memory instead of database
  requestsCache.set(requestData.request_id, {
    ...requestData,
    created_at: new Date(),
    updated_at: new Date()
  });
  return { success: true };
};

/**
 * Get a generation request by request_id
 */
exports.getGenerationRequestById = async (requestId) => {
  // Get from memory cache
  return requestsCache.get(requestId) || null;
};

/**
 * Update generation request status
 */
exports.updateGenerationStatus = async (requestId, statusData) => {
  // Update in memory
  const request = requestsCache.get(requestId);
  if (!request) return { affectedRows: 0 };
  
  if (statusData.status !== undefined) {
    request.status = statusData.status;
  }
  
  if (statusData.logs !== undefined) {
    request.logs = statusData.logs;
  }
  
  if (statusData.progress !== undefined) {
    request.progress = statusData.progress;
  }
  
  request.updated_at = new Date();
  requestsCache.set(requestId, request);
  
  return { affectedRows: 1 };
};

/**
 * Update generation request with result
 */
exports.updateGenerationResult = async (requestId, resultData) => {
  // Update in memory
  const request = requestsCache.get(requestId);
  if (!request) return { affectedRows: 0 };
  
  request.status = resultData.status;
  request.result_data = resultData.data;
  request.completed_at = new Date();
  request.updated_at = new Date();
  
  requestsCache.set(requestId, request);
  
  return { affectedRows: 1 };
};

/**
 * Get all generation requests with pagination
 */
exports.getAllGenerationRequests = async (limit = 50, offset = 0) => {
  // Get from memory cache with pagination
  const requests = Array.from(requestsCache.values());
  
  // Sort by created_at desc
  requests.sort((a, b) => b.created_at - a.created_at);
  
  // Apply pagination
  return requests.slice(offset, offset + limit);
};

/**
 * Get generation requests by model_id
 */
exports.getGenerationRequestsByModelId = async (modelId, limit = 20, offset = 0) => {
  // Filter by model_id
  const requests = Array.from(requestsCache.values())
    .filter(req => req.model_id === modelId)
    .sort((a, b) => b.created_at - a.created_at);
  
  return requests.slice(offset, offset + limit);
};

/**
 * Get generation requests by status
 */
exports.getGenerationRequestsByStatus = async (status, limit = 50, offset = 0) => {
  // Filter by status
  const requests = Array.from(requestsCache.values())
    .filter(req => req.status === status)
    .sort((a, b) => b.created_at - a.created_at);
  
  return requests.slice(offset, offset + limit);
};

/**
 * Delete old generation requests (cleanup)
 */
exports.deleteOldGenerationRequests = async (daysOld = 30) => {
  // Clear old requests
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - daysOld);
  
  let deletedCount = 0;
  
  requestsCache.forEach((value, key) => {
    if (value.created_at < threshold) {
      requestsCache.delete(key);
      deletedCount++;
    }
  });
  
  return { affectedRows: deletedCount };
}; 