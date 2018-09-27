'use strict';

const BaaSServer = require('..').Server;
const freeport = require('freeport');
const assert = require('chai').assert;
const _ = require('lodash');
const BaaSClient = require('../client');
const bcrypt = require('bcrypt');


describe('serving queueing', function () {
  let client;
  let server;

  before(function (done) {
    freeport(function (err, port) {
      if (err) { return done(err); }
      server = new BaaSServer({ port, logLevel: 'error', workers: 1 });

      server.start(function (err, address) {
        if (err) { return done(err); }
        client = new BaaSClient(_.extend({requestTimeout: 500}, address), done);
      });
    });
  });

  after(function(done) {
    client.disconnect();
    server.stop(done);
  });

  afterEach(function () {
    if (Date.unfix) { Date.unfix(); }
  });

  it('should wait until a worker is free', function (done) {
    const password = 'foobar';
    client.hash(password, _.noop);
    client.hash(password, function (err, hash) {
      if (err) { return done(err); }
      assert.ok(bcrypt.compareSync(password, hash));
      done();
    });
  });

  it('should timeout', function (done) {
    const password = 'foobar';
    server._config.workerTimeout = 10;
    client.hash(password, _.noop);
    client.hash(password, function (err) {
      assert.equal(err.reason, 'timeout');
      done();
    });
  });
});
