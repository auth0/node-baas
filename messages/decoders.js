const highland = require('highland');

const messages = require('./.');

function buildDecoder(Message) {
  return highland.pipeline(
    highland.map((buffer) => {
      // needs try catch
      try {
        return Message.toObject(Message.decode(buffer));
      } catch(e) {
        throw e;
      }
  }));
}

['Request', 'Response'].forEach(function (k) {
  module.exports[k + 'Decoder'] = function () {
    return buildDecoder(messages[k]);
  };
});
