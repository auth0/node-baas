var ResponseMessage = require('../../messages').Response;
var encoder = require('pb-stream').encoder;

module.exports = function (metrics) {
	metrics.increment('requests.processed');
  return encoder(ResponseMessage);
};