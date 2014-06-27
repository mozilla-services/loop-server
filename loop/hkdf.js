/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this
* file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var HKDF = require('hkdf');

// This namespace identifies how the Hawk credentials are being used (derived
// etc.).
// XXX This shouldn't be here but defined on the hawk middlware.
var NAMESPACE = 'identity.mozilla.com/picl/v1/';

function KW(name) {
  return new Buffer(NAMESPACE + name);
}

function hkdf(km, info, salt, len, callback) {
  var df = new HKDF('sha256', salt, km);
  df.derive(KW(info), len, callback);
}

hkdf.KW = KW;

module.exports = hkdf;
