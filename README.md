[![Build Status](https://travis-ci.org/auth0/node-baas)](https://travis-ci.org/auth0/node-baas)

Bcrypt as a service (node.js)


This module is a client and server.

## Server

Installation:

```
sudo npm i -g auth0/node-baas
```

Start a baas server on port 9485 and salt with 10 iterations:

```
baas -p 9485 -s 10
```

**Important**: The server runs bcrypt synchronously (not using the node thread pool) as it is meant to be used in servers with only 1 core due as it provides the best tx/$ relationship in AWS (t2-micro). Might make sense to make this a configurable option.

## Client

Install:

```
npm i auth0/node-baas
```

Usage

```javascript
var BaasClient = require('baas').Client;
var baas = new BaasClient('server:9485');

//or use a pool of five connections
var BaasPool = require('baas').Pool;
var baas = new BaasPool({ port: 9485, size: 5 });

//hash a password
baas.hash('mypassword', function (err, result) {
  console.log(result.hash)
});

//compare a password
baas.compare({hash: 'the bcrypt hash', password: 'mypassword'}, function (err, result) {
  console.log(result.success)
});

```

## To install on ubuntu/debian

```

sudo apt-key adv --keyserver keyserver.ubuntu.com --recv F63E3D3A
sudo sh -c 'echo deb http://debs.auth0.com/ stable main > /etc/apt/sources.list.d/auth0.list'
sudo aptitude update
sudo aptitude install -y baas

```
## Author

[Auth0](auth0.com)

## License

This project is licensed under the MIT license. See the [LICENSE](LICENSE) file for more info.
