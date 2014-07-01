/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var conf = require("./config").conf;
var hexKeyOfSize = require('./config').hexKeyOfSize;
var crypto = require('crypto');

/**
 * Returns the HMac digest of the given payload.
 *
 * If no options are passed, the global configuration object is used to
 * determine which algorithm and secret should be used.
 *
 * @param {String} payload    The string to mac.
 * @param {String} secret     key encoded as hex.
 * @param {String} algorithm  Algorithm to use (defaults to sha256).
 * @return {String} hexadecimal hash.
 **/
function hmac(payload, secret, algorithm) {
  if (secret === undefined) {
    throw new Error("You should provide a secret.");
  }

  // Test for secret size and validity
  hexKeyOfSize(16)(secret);

  if (algorithm === undefined) {
    algorithm = conf.get("userMacAlgorithm");
  }
  var _hmac = crypto.createHmac(algorithm, new Buffer(secret, "hex"));
  _hmac.write(payload);
  _hmac.end();
  return _hmac.read().toString('hex');
}

module.exports = hmac;
