/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require('./config').conf;

function getProgressURL(host) {
  var progressURL;
  if (conf.get("protocol") === "https") {
    progressURL = "wss://" + host.split(":")[0] + ":443";
  } else {
    progressURL = "ws://" + host;
  }

  return progressURL;
}

module.exports = {
  getProgressURL: getProgressURL
};
