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
    .forEach(c => {
      // Trigger a different event based on why we kill the client
      self.emit(c.stream && !c.stream.writable ? 'stream_not_writable' : 'limit_requests_per_connections_reached', { 
        request_count: c._requestCount, 
        max_request_count: self._options.maxRequestsPerConnection  
      });          
      self._killClient(c);
    });

  if (self._openClients < self._options.maxConnections) {
    self._openClients++;
    self.emit('opened_new_client', { 
      clients: self._openClients, 
      max_conncetions: self._options.maxConnections
    });    
    
    const newClient = new BaaSClient(this._connectionOptions, function () {
      self._clients.push(newClient);
      var pending = self._pendingRequests;
      self._pendingRequests = [];
      pending.forEach(cb => self._getClient(cb));
      callback(null, newClient);
    });

    newClient.on('error', function (err) {
      self.emit('error', err);
      self._killClient(newClient);
    });

    newClient.on('breaker_error', function (err) {
      self.emit('breaker_error', err);
    });

    return;
  }

  const client = self._clients.shift();

  if (!client) {
    self.emit('request_queued');    
    self._pendingRequests.push(callback);
    return;
  }

  self._clients.push(client);
  return setImmediate(callback, null, client);
};

BaaSPool.prototype.disconnect = function () {
  _.clone(this._clients)
   .forEach(c => this._killClient(c));
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
    this.emit('client_closed', client);
  } else {
    client.once('drain', function () {
      this.emit('client_closed', client);
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
