/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var crypto = require("crypto");
var base64 = require('urlsafe-base64');

function TokenManager(secret) {
  if (!secret)
    throw new Error("TokenManager requires a 'secret' argument");

  this.secret = secret;
  this.signatureSize = 32 / 8;
}

TokenManager.prototype = {
  encode: function(data) {
    var payload, signature, hmac;

    payload = new Buffer(JSON.stringify(data));

    hmac = crypto.createHmac("sha256", this.secret);
    hmac.write(payload);
    hmac.end();

    signature = hmac.read();
    // keep the last 32 bits only, so we avoid huge signatures
    signature = signature.slice(signature.length - this.signatureSize);

    return base64.encode(Buffer.concat([payload,signature]));
  },

  decode: function(token) {
    token = base64.decode(token);
    // Split token into <payload><signature: 32 bits>
    var signature = token.slice(token.length - this.signatureSize).toString();
    var payload = token.slice(0, token.length - this.signatureSize).toString();

    var hmac = crypto.createHmac("sha256", this.secret);
    hmac.write(payload);
    hmac.end();

    var payloadSignature = hmac.read();
    // The signature is always the last 32 bits only
    payloadSignature = payloadSignature
      .slice(payloadSignature.length - this.signatureSize).toString();

    if (signature !== payloadSignature)
      throw new Error("Invalid signature");

    return JSON.parse(payload);
  }
};


module.exports = {TokenManager: TokenManager};
