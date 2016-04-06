var EventEmitter = require('events').EventEmitter;

var util   = require('util');
var logger = require('./lib/logger');
var _      = require('lodash');
var net = require('net');

var agent  = require('auth0-instrumentation');
var pkg    = require('./package.json');
agent.init(pkg, process.env);
var metrics = agent.metrics;

var RequestDecoder = require('./messages/decoders').RequestDecoder;
var randomstring = require('randomstring');

var ResponseWriter = require('./lib/pipeline/response_writer');
var PasswordHasher = require('./lib/pipeline/hash_password');
var PasswordComparer = require('./lib/pipeline/compare_password');

var defaults = {
  port:      9485,
  hostname:  '0.0.0.0',
  logLevel: 'info'
};

/*
 * Creates an instance of BaaSServer.
 *
 * Options:
 *
 *  - `port` the port to listen to. Defaults to 9231.
 *  - `hostname` the hostname to bind to. Defaults to INADDR_ANY
 *  - `logLevel` the verbosity of the logs. Defaults to 'info'.
 *
 */
function BaaSServer (options) {
  EventEmitter.call(this);
  var self = this;

  this._config = _.extend({}, defaults, options);
  this._logger = logger(this._config.logLevel);
  this._server = net.createServer(this._handler.bind(this));

  this._server.on('error', function (err) {
    self.emit('error', err);
  });
}

util.inherits(BaaSServer, EventEmitter);

BaaSServer.prototype._handler = function (socket) {
  metrics.increment('requests.incoming');
  var sockets_details = _.pick(socket, ['remoteAddress', 'remotePort']);

  sockets_details.connection = socket._connection_id = randomstring.generate(5);

  var log = this._logger;


  socket.on('error', function (err) {
    log.info(_.extend(sockets_details, {
      err: {
        code:    err.code,
        message: err.message
      }
    }), 'connection error');
  }).on('close', function () {
    log.debug(sockets_details, 'connection closed');
  });

  log.debug(sockets_details, 'connection accepted');

  var decoder = RequestDecoder();

  decoder.on('error', function () {
    log.info(sockets_details, 'unknown message format');
    return socket.end();
  });

  socket.pipe(decoder)
        .pipe(PasswordHasher(this._config, socket, log))
        .pipe(PasswordComparer(this._config, socket, log))
        .pipe(ResponseWriter(metrics))
        .pipe(socket);
};

BaaSServer.prototype.start = function (done) {
  var self = this;
  var log = self._logger;

  self._server.listen(this._config.port, this._config.hostname, function(err) {
    if (err) {
      log.error(err, 'error starting server');
      self.emit('error', err);
      if (done) {
        done(err);
      }
      return;
    }

    var address = self._server.address();

    log.info(address, 'server started');

    self.emit('started', address);
    if (done) {
      done(null, address);
    }
  });

  return this;
};

BaaSServer.prototype.stop = function () {
  var self = this;
  var log = self._logger;
  var address = self._server.address();

  this._server.close(function() {
    log.debug(address, 'server closed');
    self.emit('close');
  });
};


module.exports = BaaSServer;

