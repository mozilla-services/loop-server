/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require("./config").conf;
var winston = require('winston');

var metricsFileParams = JSON.parse(JSON.stringify(conf.get('hekaMetrics')));
metricsFileParams.timestamp = false;

exports.hekaLogger = new winston.Logger({
  transports: [
    new winston.transports.File(metricsFileParams)
  ]
});

var sqlLoggerFileParams = JSON.parse(JSON.stringify(conf.get('sqlMetrics')));
var sqlLogger = new winston.Logger({
  transports: [
    new winston.transports.File(sqlLoggerFileParams)
  ]
});

exports.sqlLog = function(query) {
  if (sqlLoggerFileParams.activated) {
    sqlLogger.log(query);
  }
};
