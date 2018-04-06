const bcrypt = require('bcrypt');

const execute = module.exports = function (request) {
  const request_id = request.id;

  const result = { request_id, success: false };

  if (request.operation === 0) {
    result.success = bcrypt.compareSync(request.password, request.hash);
  } else if (request.operation === 1) {
    result.hash = bcrypt.hashSync(request.password, 10);
    result.success = true;
  }
  return result;
};

/**
 * request { id, operation, password, hash? }
 * operation { compare: 0, hash: 1}
 */
process.on('message', (request) => {
  process.send(execute(request));
});

