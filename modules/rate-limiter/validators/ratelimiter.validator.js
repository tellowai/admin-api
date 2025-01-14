const validateUserId = (userId) => {
    // Simple check: Ensure userId is provided and is a non-empty string
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
        throw new Error('Invalid user ID provided.');
    }
};

module.exports = {
    validateUserId
};
