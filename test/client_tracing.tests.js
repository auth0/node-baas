const BaaSServer = require('..').Server;
const BaaSPool = require('../pool');
const freeport = require('freeport');
const assert = require('chai').assert;
const _ = require('lodash');
const defaultTracer = require('../tracer');

describe('client (tracing)', function () {
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

  it('should allow span in hash operation', function (done) {
    var password = 'foobar';
    client.hash(password, { span: defaultTracer.startSpan() }, function (err, hash) {
      if (err) return done(err);
      assert.ok(hash);
      done();
    });
  });

  it('should allow span in compare operation', function (done) {
    var password = 'foobar';
    client.hash(password, 'salt', function (err, hash) {
      if (err) return done(err);
      client.compare(password, hash, { span: defaultTracer.startSpan() }, function (err, result) {
        if (err) return done(err);
        assert.ok(result);
        done();
      });
    });
  });

});
