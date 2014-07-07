/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require("./config").conf;
var strftime = require("strftime");
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

function logRequests(req, res, next) {
  var start =  new Date();
  res.on('finish', function() {
    var length = res._headers['content-length'] || "";
    var stop = new Date();

    console.log(
      '[%s] "%s %s HTTP/%s.%s" %s %s — (%s ms)',
      strftime(conf.get("consoleDateFormat"), start),
      req.method, req.url, req.httpVersionMajor, req.httpVersionMinor,
      res.statusCode, length, stop - start);
  });
  next();
}

module.exports = {
  handle503: handle503,
  addHeaders: addHeaders,
  logRequests: logRequests
};
