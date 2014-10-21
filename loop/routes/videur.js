/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var pjson = require("../../package.json");
var specs = require("../api-specs");


module.exports = function(app, conf) {
  /*
   * Videur integration.
   *
   */
  app.get("/api-specs", function(req, res) {
    specs.service.location = conf.get("protocol") + "://" + req.get("host");
    specs.service.version = pjson.version;
    res.json(200, specs);
  });
};
