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

var PubSub = require('./pubsub');

var middlewares = require('./middlewares');
var websockets = require('./websockets');
var hekaLogger = middlewares.hekaLogger;

var TokBox;

if (conf.get("fakeTokBox")) {
  hekaLogger.debug("server", "Calls to TokBox are now mocked.");
  TokBox = require('./tokbox').FakeTokBox;
} else {
  TokBox = require('./tokbox').TokBox;
}

var getStorage = require('./storage');
var storage = getStorage(conf.get("storage"), {
  'tokenDuration': conf.get('tokBox').tokenDuration,
  'roomExtendTTL': conf.get('rooms').extendTTL,
  'hawkSessionDuration': conf.get('hawkSessionDuration'),
  'callDuration': conf.get('callDuration'),
  'roomsDeletedTTL': conf.get('rooms').deletedTTL
});

var statsdClient;
if (conf.get('statsdEnabled') === true) {
  statsdClient = new StatsdClient(conf.get('statsd'));
}

var tokBox = new TokBox(conf.get('tokBox'), statsdClient);

var ravenClient = new raven.Client(conf.get('sentryDSN'));

var startupMessage = 'Server was able to communicate with Sentry';
ravenClient.captureMessage(startupMessage, {level: 'info'});

function logError(err) {
  if (conf.get('env') !== 'test') {
    hekaLogger.debug("error", err);
  }
  ravenClient.captureError(err);
}

var Notifications = require("./notifications");
var notifications = new Notifications(new PubSub(conf.get('pubsub'), logError));

var corsEnabled = cors({
  origin: function(origin, callback) {
    var allowedOrigins = conf.get('allowedOrigins');
    var acceptedOrigin = allowedOrigins.indexOf('*') !== -1 ||
                         allowedOrigins.indexOf(origin) !== -1;
    callback(null, acceptedOrigin);
  }
});

var SimplePush = require("./simplepush");
var simplePush = new SimplePush(statsdClient);


var app = express();

/**
 * Enable CORS for all requests.
 **/
app.use(corsEnabled);
app.use(middlewares.addHeaders);
app.disable('x-powered-by');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(middlewares.handle503(logError));
app.use(middlewares.logMetrics);

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
                                simplePush, auth, validators);

var pushServerConfig = require("./routes/push-server-config");
pushServerConfig(apiRouter, conf);

if (conf.get("fxaOAuth").activated !== false) {
  var fxaOAuth = require("./routes/fxa-oauth");
  fxaOAuth(apiRouter, conf, logError, storage, auth, validators);
}

var rooms = require("./routes/rooms");
rooms(apiRouter, conf, logError, storage, auth, validators, tokBox,
      simplePush, notifications);

var session = require("./routes/session");
session(apiRouter, conf, storage, auth);

var videur = require("./routes/videur");
videur(apiRouter, conf);


app.use(apiPrefix, apiRouter);
app.use("/", apiRouter);

// Exception logging should come at the end of the list of middlewares.
app.use(raven.middleware.express(conf.get('sentryDSN')));

// Proceed with extra care if you change the order of these middlwares.
// Redirect must happen last.
app.use(middlewares.handleRedirects(apiPrefix));
app.use(middlewares.handleUncatchedErrors);

// Starts HTTP server.
var argv = require('yargs').argv;
var server = http.createServer(app);

if (argv.hasOwnProperty("fd")) {
  var fd = parseInt(argv.fd, 10);
  server.listen({fd: fd}, function() {
    hekaLogger.debug("server", 'Server listening on fd://' + fd);
  });
} else {
  server.listen(conf.get('port'), conf.get('ip'), function() {
    hekaLogger.debug("server", 'Server listening on http://' +
                     conf.get('ip') + ':' + conf.get('port'));
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
function shutdown(callback) {
  server.close(function() {
    process.exit(0);
    if (callback !== undefined) {
      callback();
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
