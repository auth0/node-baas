const BaaSServer = require('..').Server;
const BaaSPool = require('../pool');
const freeport = require('freeport');
const assert = require('chai').assert;
const _ = require('lodash');

describe('client (wrong signature)', function () {
  var server, client;

  before(function (done) {
    freeport(function (err, port) {
      if (err) { return done(err); }
      server = new BaaSServer({ port, logLevel: 'error' });

      server.start(function (err, address) {
        if (err) return done(err);
        client = new BaaSPool(_.extend({}, address, { pool: { maxConnections: 1 } }));
        done();
      });
    });
  });

  after(function(done) {
    client.disconnect();
    server.stop(done);
  });

  it('should error when signature is broken', function (done) {
    var password = 'foobar';
    client.hash(password, function (err, hash) {
      if (err) return done(err);
      client.compare({'foo': 'bar'}, hash, function (err, result) {
        assert.ok(err);
        assert.notOk(result);
        done();
      });
    });
  });

});
