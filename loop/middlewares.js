/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require("./config").conf;
var strftime = require('strftime');

function handle503(logError) {
  return function UnavailableService(req, res, next) {
    res.serverError = function raiseError(error) {
      if (error) {
        logError(error);
        res.json(503, "Service Unavailable");
        return true;
      }
      return false;
    };
    
    next();
  };
}

function addHeaders(req, res, next) {
  res.once('header', function() {
    if (res.statusCode === 200 || res.statusCode === 401) {
      res.setHeader('Timestamp', new Date().getTime());
    }

    if (res.statusCode === 503) {
      res.setHeader('Retry-After', conf.get('retryAfter'));
    }
  });
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
