const BaaSServer = require('..').Server;
const BaaSPool = require('../pool');
const freeport = require('freeport');
const assert = require('chai').assert;
const _ = require('lodash');
const async = require('async');

describe('client (circuit-breaker)', function () {
  var server, client;

  before(function (done) {
    freeport(function (err, port) {
      if (err) { return done(err); }
      server = new BaaSServer({ port, logLevel: 'error' });

      server.start(function (err, address) {
        if (err) return done(err);
        client = new BaaSPool(_.extend({}, address, {
          pool: {
            maxConnections: 1
          },
          breaker: {
            maxFailures: 1,
            timeout: 500,
            cooldown: 500
          }
        }));
        done();
      });
    });
  });

  after(function(done) {
    client.disconnect();
    server.stop(done);
  });

  it('should be able to hash a password', function (done) {
    //this tests will remove all workers from the server
    //in order to cause timeouts in the client.

    const workers = server._workers;
    const removeWorkers = (cb) => {
      server._workers = [];
      cb();
    };
    const putWorkers = (cb) => {
      server._workers = workers;
      cb();
    };

    async.series([
      removeWorkers,
      cb => client.hash('foo', (err) => {
        assert.match(err.message, /timeout/);
        cb();
      }),
      cb => client.hash('foo', (err) => {
        assert.match(err.message, /open/);
        cb();
      }),
      putWorkers,
      cb => client.hash('foo', (err) => {
        assert.match(err.message, /open/);
        cb();
      }),
      cb => setTimeout(cb, 500),
      cb => client.hash('foo', (err) => {
        assert.notOk(err);
        cb();
      }),
    ], done);
  });

});
