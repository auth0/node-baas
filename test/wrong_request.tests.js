const BaaSServer = require('..').Server;
const Socket = require('net').Socket;
const freeport = require('freeport');

describe('wrong requests', function () {
  var server, address, socket;

  before(function (done) {
    freeport(function(err, port) {
      if (err) { return done(err); }
      server = new BaaSServer({logLevel: 'error', port});

      server.start(function (err, addr) {
        if (err) return done(err);
        address = addr;
        done();
      });
    });
  });

  after(function(done) {
    socket.destroy();
    server.stop(done);
  });

  it('should disconnect the socket on unknown message', function (done) {
    socket = new Socket();
    var ResponseMessage  = require('../messages').Response;
    // I'm going to make the server fail by sending a Response message from the client.
    socket.connect(address.port, address.address)
      .once('connect', function () {
        socket.write(ResponseMessage.encode(ResponseMessage.create({
          request_id: '123',
        })).finish());
      }).once('close', function () {
        done();
      });

  });

});
