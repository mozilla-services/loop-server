/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require("./config").conf;
var loopPackageData = require('../package.json');
var os = require("os");

// Assume the hostname will not change once the server is launched.
var hostname = os.hostname();
var sendError = require("./utils").sendError;
var errors = require("./errno.json");


function handle503(logError) {
  return function UnavailableService(req, res, next) {
    res.serverError = function raiseError(error) {
      if (error) {
        logError(error);
        sendError(res, 503, errors.BACKEND, "Service Unavailable");
        return true;
      }
      return false;
    };

    next();
  };
}

function addHeaders(req, res, next) {
  /* Make sure we don't decorate the writeHead more than one time. */
  if (res._headersMiddleware) {
    next();
    return;
  }

  var writeHead = res.writeHead;
  res._headersMiddleware = true;
  res.writeHead = function headersWriteHead() {
    if (res.statusCode === 200 || res.statusCode === 401) {
      res.setHeader('Timestamp', Date.now());
    }

    if (res.statusCode === 503 || res.statusCode === 429) {
      res.setHeader('Retry-After', conf.get('retryAfter'));
    }
    writeHead.apply(res, arguments);
  };
  next();
}


function logMetrics(req, res, next) {
  if (conf.get('metrics') === true) {
    var start =  new Date();

    res.on('finish', function() {
      var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

      var line = {
        op: 'request.summary',
        code: res.statusCode,
        path: req.path,
        query: req.query,
        agent: req.headers['user-agent'],
        t: Date.now() - start,
        uid: req.user,
        token: req.token,
        v: loopPackageData.version,
        name: loopPackageData.name,
        hostname: hostname,
        lang: req.headers["accept-language"],
        ip: ip,
        errno: res.errno || 0
      };

      console.log(JSON.stringify(line));
    });
  }
  next();
}


module.exports = {
  handle503: handle503,
  addHeaders: addHeaders,
  logMetrics: logMetrics
};
