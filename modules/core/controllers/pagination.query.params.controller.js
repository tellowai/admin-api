const config = require('../../../config/config');


exports.initPaginationData = function(queryParams, inputOrder = 'DESC') {
     // Pagination
    const page = (queryParams.page)? (
            (queryParams.page>0)? parseInt(queryParams.page): 1
        ) : 1;
    const limit = (queryParams.limit)? (
            (queryParams.limit>0)? parseInt(queryParams.limit): config.pagination.itemsPerPage
        ) : config.pagination.itemsPerPage;
    const offset = (page - 1) * limit;

    // Sorting
    const sortBy = queryParams.sortBy || 'created_at';
    const order = (queryParams.order && queryParams.order == 'DESC')? 'DESC' : (inputOrder? inputOrder : 'DESC');


    return {
        page,
        limit,
        offset,
        sortBy,
        order
    }
}
