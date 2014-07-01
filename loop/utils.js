/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require('./config').conf;
var hmac = require('./hmac');

function buildId(id) {
  return hmac(id, conf.get("hawkIdSecret"));
}

module.exports = {
  buildId: buildId
};
