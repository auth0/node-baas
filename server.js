const cluster = require('cluster');

const EventEmitter = require('events').EventEmitter;

const util           = require('util');
const bunyan         = require('bunyan');
const _              = require('lodash');
const net            = require('net');
const Deque          = require('double-ended-queue');

const RequestDecoder = require('./messages/decoders').RequestDecoder;
const randomstring   = require('randomstring');

const ResponseWriter = require('./lib/pipeline/response_writer');
const through2       = require('through2');
const Request        = require('./messages').Request;
const Response       = require('./messages').Response;
const AWS            = require('aws-sdk');
const enableDestroy  = require('server-destroy');
const defaultTracer = require('./tracer');

const defaults = {
  port:     9485,
  hostname: '0.0.0.0',
  logLevel: 'info',
  socketTimeout: 2000,
  metrics: {
    gauge:     _.noop,
    increment: _.noop,
    observeBucketed: _.noop,
    histogram: _.noop,
    flush:     _.noop
  },
  logger: bunyan.createLogger({
    name:        'baas',
    level:       'error',
    serializers: bunyan.stdSerializers
  }),
  tracer: defaultTracer
};

function fork_worker() {
  const worker = cluster.fork();

  worker._pendingRequests = new Map();

  worker.on('message', function (response) {
    var response = Response.create(response);
    const callback = worker._pendingRequests.get(response.request_id);
    worker._pendingRequests.delete(response.request_id);
    worker.emit('drain');
    return callback(null, response);
  });

  worker.sendRequest = function (message, callback) {
    worker._pendingRequests.set(message.id, callback);
    worker.send(Request.toObject(message));
  };

  return worker;
}

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

  this._config = _.extend({}, defaults, options);
  this._logger = this._config.logger;
  this._server = net.createServer(this._handler.bind(this));
  enableDestroy(this._server);
  this._metrics = this._config.metrics;
  this._tracer = this._config.tracer;
  this._server.on('error', (err) => {
    this.emit('error', err);
  });


  cluster.setupMaster({
    exec: __dirname + '/worker.js'
  });

  var workers_number;

  if (options.workers) {
    workers_number = options.workers;
  } else if (!isNaN(process.env.WORKERS)) {
    workers_number = parseInt(process.env.WORKERS, 10);
  } else {
    workers_number = Math.max(require('os').cpus().length - 1, 1);
  }

  this._queue = new Deque();
  this._workers = _.range(workers_number).map(fork_worker);

  this._workers.forEach(worker => {
    worker.on('drain', () => {
      const pending = this._queue.shift();
      if (!pending) {
        this._workers.push(worker);
      } else {
        worker.sendRequest(pending.request, pending.done(worker.id, true));
      }
    });
  });

  if (process.env.REPORT_QUEUE_LENGTH) {
    this.cloudWatch = new AWS.CloudWatch();
    this._intervalQueued = 0;
    setInterval(this._reportQueueLength.bind(this), 1000);
  }
}

util.inherits(BaaSServer, EventEmitter);

BaaSServer.prototype._reportQueueLength = function () {
  this._metrics.gauge('requests.queued', this._intervalQueued);

  const dimensions = [];

  if (process.env.STACK_NAME) {
    dimensions.push({
      Name: 'StackName',
      Value: process.env.STACK_NAME
    });
  }

  const intervalQueued = this._intervalQueued;
  this._intervalQueued = 0;

  this.cloudWatch.putMetricData({
    MetricData: [
      {
        MetricName: 'QueuedRequests',
        Unit:       'Count',
        Timestamp:  new Date(),
        Value:      intervalQueued,
        Dimensions: dimensions
      }
    ],
    Namespace: 'Auth0/BAAS'
  }, (err) => {
    if (err) {
      this._logger.error({ err }, err.message);
    }
  });
};

BaaSServer.prototype._handler = function(socket) {
  this._metrics.increment('connection.incoming');

  const sockets_details = _.pick(socket, ['remoteAddress', 'remotePort']);

  sockets_details.connection = socket._connection_id = randomstring.generate(5);

  const log = this._logger;

  socket.on('error', (err) => {
    this._metrics.increment('connection.error');
    log.info(_.extend(sockets_details, {
      err: {
        code:    err.code,
        message: err.message
      }
    }), 'connection error');
  }).on('close', () => {
    this._metrics.increment('connection.closed');
    log.info(sockets_details, 'connection closed');
  });

  if (this._config.socketTimeout) {
    socket.setTimeout(this._config.socketTimeout);
    socket.once('timeout', () => {
      log.info(sockets_details, 'idle connection closed');
      return socket.end();
    });
  }

  log.info(sockets_details, 'connection accepted');

  const decoder = RequestDecoder();

  decoder.on('error',  (err) => {
    log.info(_.extend(sockets_details, err), 'unknown message format');
    return socket.end();
  });

  const responseStream = ResponseWriter();

  responseStream.pipe(socket);

  socket.pipe(decoder)
    .pipe(through2.obj((request, encoding, callback) => {
      const operation = request.operation === 0 ? 'compare' : 'hash';
      const start = Date.now();
      const wireCtx = this._tracer.extract(this._tracer.FORMAT_AUTH0_BINARY, request.trace_context);
      const span = this._tracer.startSpan(operation, { childOf: wireCtx });
      span.setTag(this._tracer.Tags.SPAN_KIND, this._tracer.Tags.SPAN_KIND_RPC_SERVER);
      span.setTag('request.id', request.id);
      span.setTag(this._tracer.Tags.PEER_ADDRESS, sockets_details.remoteAddress);
      span.setTag(this._tracer.Tags.PEER_PORT, sockets_details.remotePort);

      const done = (worker_id, enqueued) => {
        return (err, response) => {
          if (err) {
            span.setTag(this._tracer.Tags.ERROR, true);
          }
          span.setTag('enqueued', enqueued);
          span.setTag('worker.id', worker_id);
          span.finish();
          const took = Date.now() - start;
          log.info({
            request:    request.id,
            connection: socket._connection_id,
            took:       took,
            worker:     worker_id,
            operation:  operation,
            enqueued:   enqueued,
            log_type:   'response'
          }, `${operation} completed`);

          this._metrics.observeBucketed(
            `requests.processed.${operation}.latency`,
            took,
            [50, 80, 100, 150, 250, 500]);
            
          this._metrics.histogram(`requests.processed.${operation}.time`, took);
          this._metrics.increment(`requests.processed.${operation}`);

          responseStream.write(response);
        };
      };

      this._metrics.increment('requests.incoming');

      log.info({
        request:    request.id,
        connection: socket._connection_id,
        operation:  operation,
        log_type:   'request',
        queued:     this._workers.length === 0
      }, `incoming ${operation}`);

      if (!this._workers.length){
        this._intervalQueued++;
        // no available workers, queue and wait
        this._queue.push({request, done});
        return callback();
      }

      // all workers are the same, pop is faster than shift: http://stackoverflow.com/questions/6501160/why-is-pop-faster-than-shift
      const worker = this._workers.pop();

      worker.sendRequest(request, done(worker.id, false));

      callback();
    }));
};

BaaSServer.prototype.start = function (done) {
  const log = this._logger;

  this._server.listen(this._config.port, this._config.hostname, (err) => {
    if (err) {
      log.error(err, 'error starting server');
      this.emit('error', err);
      if (done) { done(err); }
      return;
    }

    const address = this._server.address();

    log.info(address, 'server started');

    this.emit('started', address);

    if (done) { return done(null, address); }
  });

  return this;
};

BaaSServer.prototype.stop = function (done) {
  const log = this._logger;
  const address = this._server.address();

  const timeout = setTimeout(() => {
    this._server.destroy();
  }, 500);

  this._server.close(() => {
    clearTimeout(timeout);
    log.info(address, 'server closed');
    this.emit('close');
    if (done) { done(); }
  });
};


module.exports = BaaSServer;
