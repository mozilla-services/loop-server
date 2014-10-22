/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var pjson = require("../../package.json");
var specs = require("../api-specs");
var config = require('../config').conf;


module.exports = function(app, conf) {
  /*
   * Videur integration.
   *
   */

  var room_tsize = Math.ceil(config.get('rooms').tokenSize / 3 * 4);
  var call_tsize = Math.ceil(config.get('callUrls').tokenSize / 3 * 4);

  app.get("/api-specs", function(req, res) {
    specs.service.location = conf.get("protocol") + "://" + req.get("host");
    specs.service.version = pjson.version;

    var rooms_key = "regexp:/rooms/[a-zA-Z0-9_-]{" + room_tsize + "}";
    specs.service.resources[rooms_key] = specs.service.resources["_ROOMS_"];
    delete specs.service.resources._ROOMS_;

    var calls_key = "regexp:/calls/[a-zA-Z0-9_-]{" + call_tsize + "}";
    specs.service.resources[calls_key] = specs.service.resources["_CALLS_"];
    delete specs.service.resources._CALLS_;

    res.json(200, specs);
  });
};
