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

  res.errno = errno;
  res.status(code).json(errmap);
}

function getProgressURL(host) {
  var progressURL;
  if (conf.get("protocol") === "https") {
    progressURL = "wss://" + host.split(":")[0] + ":443";
  } else {
    progressURL = "ws://" + host;
  }

  return progressURL + conf.get('progressURLEndpoint');
}

function isoDateString(d){
  function pad(n){
    return n < 10 ? '0' + n : n;
  }
  return d.getUTCFullYear() + '-' +
    pad(d.getUTCMonth() + 1) + '-' +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) + ':' +
    pad(d.getUTCMinutes()) + ':' +
    pad(d.getUTCSeconds()) + 'Z';
}

module.exports = {
  getProgressURL: getProgressURL,
  sendError: sendError,
  isoDateString: isoDateString
};
