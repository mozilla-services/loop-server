/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require('./config').conf;

// Configure http agents to use more than the default number of sockets.
var http = require('http');
var https = require('https');
https.globalAgent.maxSockets = conf.get('maxHTTPSockets');
http.globalAgent.maxSockets = conf.get('maxHTTPSockets');

var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var raven = require('raven');
var cors = require('cors');
var StatsdClient = require('statsd-node').client;
var addHeaders = require('./middlewares').addHeaders;
var handle503 = require("./middlewares").handle503;
var logMetrics = require('./middlewares').logMetrics;
var websockets = require('./websockets');

var TokBox;

if (conf.get("fakeTokBox") === true) {
  console.log("Calls to TokBox are now mocked.");
  TokBox = require('./tokbox').FakeTokBox;
} else {
  TokBox = require('./tokbox').TokBox;
}

var getStorage = require('./storage');
var storage = getStorage(conf.get("storage"), {
  'tokenDuration': conf.get('tokBox').tokenDuration,
  'hawkSessionDuration': conf.get('hawkSessionDuration'),
  'callDuration': conf.get('callDuration'),
  'maxSimplePushUrls': conf.get('maxSimplePushUrls')
});

var tokBox = new TokBox(conf.get('tokBox'));

var ravenClient = new raven.Client(conf.get('sentryDSN'));
var statsdClient;
if (conf.get('statsdEnabled') === true) {
  statsdClient = new StatsdClient(conf.get('statsd'));
}

function logError(err) {
  console.log(err);
  ravenClient.captureError(err);
}


var corsEnabled = cors({
  origin: function(origin, callback) {
    var allowedOrigins = conf.get('allowedOrigins');
    var acceptedOrigin = allowedOrigins.indexOf('*') !== -1 ||
                         allowedOrigins.indexOf(origin) !== -1;
    callback(null, acceptedOrigin);
  }
});


var app = express();

/**
 * Enable CORS for all requests.
 **/
app.use(corsEnabled);
app.use(addHeaders);
app.disable('x-powered-by');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(handle503(logError));
app.use(logMetrics);

var authMiddlewares = require("./auth");
var auth = authMiddlewares(conf, logError, storage, statsdClient);

var getValidators = require("./routes/validators");
var validators = getValidators(conf, logError, storage);

var home = require("./routes/home");
home(app, conf, logError, storage, tokBox);

var registration = require("./routes/registration");
registration(app, conf, logError, storage, auth, validators);

var account = require("./routes/account");
account(app, storage, auth);

var callUrl = require("./routes/call-url");
callUrl(app, conf, logError, storage, auth, validators, statsdClient);

var calls = require("./routes/calls");
var storeUserCallTokens = calls(app, conf, logError, storage, tokBox,
                                auth, validators);

var pushServerConfig = require("./routes/push-server-config");
pushServerConfig(app, conf);

// Exception logging should come at the end of the list of middlewares.
app.use(raven.middleware.express(conf.get('sentryDSN')));

// Starts HTTP server.
var argv = require('yargs').argv;
var server = http.createServer(app);

if (argv.hasOwnProperty("fd")) {
  var fd = parseInt(argv.fd, 10);
  var net = require("net");
  var util = require('util');
  var rval = net._createServerHandle(null, null, null, null, fd);
  if (typeof rval === "number") {
    var error = util._errnoException(rval, 'listen');
    process.nextTick(function() {
      server.emit('error', error);
    });
    return;
  }
  server._handle = rval;
  server._handle.onconnection = function onconnection(err, clientHandle) {
    console.log("Connection");
    var handle = this;
    var self = handle.owner;
    if (err) {
      self.emit('error', util._errnoException(err, 'accept'));
      return;
    }
    if (self.maxConnections && self._connections >= self.maxConnections) {
      clientHandle.close();
      return;
    }
    var socket = new net.Socket({
      handle: clientHandle,
      allowHalfOpen: self.allowHalfOpen
    });
    socket.readable = socket.writable = true;
    self._connections++;
    socket.server = self;
    // DTRACE_NET_SERVER_CONNECTION(socket);
    // COUNTER_NET_SERVER_CONNECTION(socket);
    self.emit('connection', socket);
  };
  server._handle.owner = server;
  process.nextTick(function() {
    // ensure handle hasn't closed
    if (server._handle)
      console.log("Server listening on fd://" + argv.fd);
  });
} else {
  server.listen(conf.get('port'), conf.get('host'), function(){
    console.log('Server listening on http://' +
                conf.get('host') + ':' + conf.get('port'));
  });
}

// Handle websockets.
var ws = websockets(storage, logError, conf);
try {
  ws.register(server);
} catch (e) {
  logError(e);
}

// Handle SIGTERM signal.
function shutdown(cb) {
  server.close(function() {
    process.exit(0);
    if (cb !== undefined) {
      cb();
    }
  });
}

process.on('SIGTERM', shutdown);

module.exports = {
  app: app,
  server: server,
  conf: conf,
  storage: storage,
  request: request,
  tokBox: tokBox,
  statsdClient: statsdClient,
  shutdown: shutdown,
  storeUserCallTokens: storeUserCallTokens,
  auth: auth,
  validators: validators
};
