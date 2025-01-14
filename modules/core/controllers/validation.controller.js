var _ = require('lodash');

module.exports.validate = function (schema, payload) {

  var response = {};
  var errorMessages = [];
  const payloadValidation = schema.validate(payload, {
    stripUnknown : true,
    abortEarly : false
  });

  // if(payloadValidation.error && payloadValidation.error.details) {

  //   _.map(payloadValidation.error.details, function (item) {
      
  //     errorMessages.push(item);
  //   });
  // }

  if(payloadValidation.error && payloadValidation.error.details) {

    response.error = payloadValidation.error.details;
  }

  response.value = payloadValidation.value;

  return response;
}

module.exports.validateForAtleastOneValid = function (schema, payload) {
  var response = {};
    
    const payloadValidation = schema.validate(payload, {
        stripUnknown: true,
        abortEarly: false
    });

    if (payloadValidation.error) {
        if (payloadValidation.error.details.some(detail => detail.type === 'array.oneValid')) {
            response.error = [{
                message: 'At least one valid entry is required in the data array',
                path: ['data']
            }];
        } else {
            response.error = payloadValidation.error.details;
        }
    }

    response.value = payloadValidation.value;

    return response;
};
