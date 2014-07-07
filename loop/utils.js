/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require('./config').conf;

function sendError(res, code, errno, error, message, info) {
  var errmap = {};
  if (code) {
    errmap.code = code;
  }
  if (errno) {
    errmap.errno = errno;
  }
  if (error) {
    errmap.error = error;
  }
  if (message) {
    errmap.message = message;
  }
  if (info) {
    errmap.info = info;
  }

  res.json(code, errmap);
}

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
  getProgressURL: getProgressURL,
  sendError: sendError
};
