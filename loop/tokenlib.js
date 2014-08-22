/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var randomBytes = require("crypto").randomBytes;
var ONE_HOUR = 60 * 60;

/**
 * Return a url token of [a-zA-Z0-9-_] character and size length.
 */
function generateToken(bytes) {
  return randomBytes(bytes)
    .toString("base64")
    .replace(/\=/g, '')
    .replace(/\//g, '_')
    .replace(/\+/g, '-');
}

module.exports = {
  generateToken: generateToken,
  ONE_HOUR: ONE_HOUR
};
