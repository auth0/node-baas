const magic = require('auth0-magic');

const execute = module.exports = function (request, callback) {
  const request_id = request.id;

  if (request.operation === 0) {
    //compare
    magic.alt.verify.bcrypt(request.password, request.hash, function(err) {
      callback(null, { request_id, success: !err })
    });
  } else if (request.operation === 1) {
    //hash
    magic.alt.password.bcrypt(request.password, function(err, output) {
      callback(null, { request_id, success: !err, hash: output.hash })
    });
  } else {
    callback(null, { request_id, success: false })
  }
};

/**
 * request { id, operation, password, hash? }
 * operation { compare: 0, hash: 1}
 */
process.on('message', (request) => {
  execute(request, function(err, result) {
    process.send(result)
  });
});
