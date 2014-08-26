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
var raven = require('raven');
var cors = require('cors');
var StatsdClient = require('statsd-node').client;
var addHeaders = require('./middlewares').addHeaders;
var handle503 = require("./middlewares").handle503;
var logMetrics = require('./middlewares').logMetrics;
var sendError = require('./utils').sendError;
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
  if (conf.get('env') !== 'test') {
    console.log(err);
  }
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

var apiRouter = express.Router();
var loopPackageData = require('../package.json');
var apiPrefix = "/v" + loopPackageData.version.split(".")[0];
var authMiddlewares = require("./auth");
var auth = authMiddlewares(conf, logError, storage, statsdClient);

var getValidators = require("./routes/validators");
var validators = getValidators(conf, logError, storage);

var home = require("./routes/home");
home(apiRouter, conf, logError, storage, tokBox);

var registration = require("./routes/registration");
registration(apiRouter, conf, logError, storage, auth, validators);

var account = require("./routes/account");
account(apiRouter, storage, auth);

var callUrl = require("./routes/call-url");
callUrl(apiRouter, conf, logError, storage, auth, validators, statsdClient);

var calls = require("./routes/calls");
var storeUserCallTokens = calls(apiRouter, conf, logError, storage, tokBox,
                                auth, validators);

var pushServerConfig = require("./routes/push-server-config");
pushServerConfig(apiRouter, conf);

var fxaOAuth = require("./routes/fxa-oauth");
fxaOAuth(apiRouter, conf, logError, storage, auth, validators);

var session = require("./routes/session");
session(apiRouter, auth);

app.use(apiPrefix, apiRouter);

// Exception logging should come at the end of the list of middlewares.
app.use(raven.middleware.express(conf.get('sentryDSN')));

// In case of apiPrefix missing redirect the user to the right URL
// In case of apiPrefix present, raise a 404 error.
// Must be the last middleware.
app.use(function(req, res) {
  if (req.path.indexOf(apiPrefix) !== 0) {
    res.redirect(307, apiPrefix + req.path);
    return;
  }
  sendError(res, 404, 999, "Resource not found.");
});

/* eslint-disable */
app.use(function(error, req, res, next) {
/* eslint-enable */
  sendError(res, 500, 999, "" + error);
});

// Starts HTTP server.
var argv = require('yargs').argv;
var server = http.createServer(app);

if (argv.hasOwnProperty("fd")) {
  var fd = parseInt(argv.fd, 10);
  server.listen({fd: fd}, function() {
    console.log('Server listening on fd://' + fd);
  });
} else {
  server.listen(conf.get('port'), conf.get('host'), function() {
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
  apiRouter: apiRouter,
  apiPrefix: apiPrefix,
  server: server,
  conf: conf,
  storage: storage,
  tokBox: tokBox,
  statsdClient: statsdClient,
  shutdown: shutdown,
  storeUserCallTokens: storeUserCallTokens,
  auth: auth,
  validators: validators
};
