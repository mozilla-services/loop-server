/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require("./config").conf;
var pjson = require('../package.json');
var os = require("os");

// We make the assumption that this won't change once launched.
var hostname = os.hostname();

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
      res.setHeader('Timestamp', Date.now());
    }

    if (res.statusCode === 503) {
      res.setHeader('Retry-After', conf.get('retryAfter'));
    }
  });
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
        user: req.user,
        token: req.token,
        callUrlData: req.callUrlData,
        v: pjson.version,
        name: pjson.name,
        hostname: hostname,
        lang: req.headers["accept-language"],
        ip: ip
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
