const multer = require('multer');
const path = require('path');


// Multer configuration for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1048576 }, // 1 MB limit
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.json$/i)) {
      req.fileValidationError = 'Only JSON files are allowed!';
      return cb(new Error({
        message: 'Only JSON files are allowed!'
      }), false);
    }
    
    return cb(null, true);
  }
});

module.exports = { upload };
