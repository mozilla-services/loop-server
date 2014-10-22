/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var pjson = require("../../package.json");
var specs = require("../api-specs");
var config = require('../config').conf;


module.exports = function(app, conf) {
  var roomTokenSize = Math.ceil(config.get('rooms').tokenSize / 3 * 4);
  var callTokenSize = Math.ceil(config.get('callUrls').tokenSize / 3 * 4);
  var location = conf.get("protocol") + "://" + conf.get("publicServerAddress");

  app.get("/api-specs", function(req, res) {
    var strSpec = JSON.stringify(specs);
    strSpec = strSpec.replace('{roomTokenSize}', roomTokenSize);
    strSpec = strSpec.replace('{callTokenSize}', callTokenSize);
    strSpec = strSpec.replace('{location}', location);
    strSpec = strSpec.replace('{version}', pjson.version);
    res.json(200, JSON.parse(strSpec));
  });
};
