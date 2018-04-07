const ProtoBuf = require('protobufjs');
const path = require('path');

const root = new ProtoBuf.Root();

module.exports = root
  .loadSync(path.join(__dirname, '/../protocol/Index.proto'), { keepCase: true })
  .lookup('baas');
