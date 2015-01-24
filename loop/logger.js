/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require("./config").conf;
var mozlog = require('mozlog');
var loopPackageData = require('../package.json');

var metricsFileParams = JSON.parse(JSON.stringify(conf.get('hekaMetrics')));
delete metricsFileParams.activated;
if (metricsFileParams.debug === true) {
  metricsFileParams.level = "DEBUG";
}
metricsFileParams.app = loopPackageData.name;

mozlog.config(metricsFileParams);

exports.hekaLogger = mozlog();
