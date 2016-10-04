const _            = require('lodash');
const EventEmitter = require('events').EventEmitter;
const BaaSClient   = require('./client');
const util         = require('util');

function BaaSPool (options) {
  EventEmitter.call(this);

  this._connectionOptions = _.omit(options, ['pool']);

  this._options = _.extend({
    maxConnections: 20,
    maxRequestsPerConnection: 10000
  }, options.pool || {});

  this._clients = [];
  this._openClients = 0;
  this._pendingRequests = [];
}

util.inherits(BaaSPool, EventEmitter);

BaaSPool.prototype._getClient = function (callback) {
  const self = this;

  self._clients
      .filter(c => c._requestCount >= self._options.maxRequestsPerConnection || (c.stream && !c.stream.writable))
      .forEach(c => self._killClient(c));

  if (self._openClients < self._options.maxConnections) {
    self._openClients++;
    const newClient = new BaaSClient(this._connectionOptions, function () {
      self._clients.push(newClient);
      var pending = self._pendingRequests;
      self._pendingRequests = [];
      pending.forEach(cb => self._getClient(cb));
      callback(null, newClient);
    });

    newClient.on('error', function () {
      self._killClient(newClient);
    });

    return;
  }

  const client = self._clients.shift();

  if (!client) {
    self._pendingRequests.push(callback);
    return;
  }

  self._clients.push(client);
  return setImmediate(callback, null, client);
};

BaaSPool.prototype.disconnect = function () {
  this._clients.forEach(c => this._killClient(c));
};

BaaSPool.prototype._killClient = function (client) {
  const self = this;
  self._openClients--;
  _.pull(self._clients, client);

  if (client.socket) {
    client.socket.reconnect = false;
    if (!client.socket.connected) {
      return;
    }
  }

  if (client._pendingRequests === 0) {
    client.disconnect();
  } else {
    client.once('drain', function () {
      client.disconnect();
    });
  }
};

['compare', 'hash'].forEach(function (method) {
  BaaSPool.prototype[method] = function () {
    const args = Array.from(arguments);
    const callback = args[args.length - 1];
    const self = this;

    self._getClient(function (err, client) {
      if (err) {
        return callback(err);
      }

      client[method].apply(client, args);
    });
  };
});

module.exports = BaaSPool;
