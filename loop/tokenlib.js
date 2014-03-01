/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var crypto = require("crypto");
var base64 = require('urlsafe-base64');

function TokenManager(secret, options) {
  if (!secret)
    throw new Error("TokenManager requires a 'secret' argument");
  options = options || {};

  this.secret = secret;
  this.signatureSize = options.signatureSize || 32 / 8;
  this.digestAlgorithm = options.digestAlgorithm || "sha256";
  if (!options.timeout)
    this.timeout = 60 * 60 * 24 * 30 * 1000; // 1 month
  else
    this.timeout = options.timeout;
}

TokenManager.prototype = {
  encode: function(data) {
    var payload, signature, hmac;
    data.expires = data.expires || Date.now() + this.timeout;

    payload = new Buffer(JSON.stringify(data));

    hmac = crypto.createHmac(this.digestAlgorithm, this.secret);
    hmac.write(payload);
    hmac.end();

    signature = hmac.read();
    // keep the last `signatureSize` bytes only, so we avoid huge signatures
    signature = signature.slice(signature.length - this.signatureSize);

    return base64.encode(Buffer.concat([payload,signature]));
  },

  decode: function(token) {
    token = base64.decode(token);
    // Split token into <payload><signature: signatureSize bytes>
    var signature = token.slice(token.length - this.signatureSize).toString();
    var payload = token.slice(0, token.length - this.signatureSize).toString();

    var hmac = crypto.createHmac(this.digestAlgorithm, this.secret);
    hmac.write(payload);
    hmac.end();

    var payloadSignature = hmac.read();
    // The signature is the last `signatureSize` bits only
    payloadSignature = payloadSignature
      .slice(payloadSignature.length - this.signatureSize).toString();

    if (signature !== payloadSignature)
      throw new Error("Invalid signature");

    var data = JSON.parse(payload);
    if (data.expires < new Date().getTime())
      throw new Error("The token expired");

    return data;
  }
};


module.exports = {TokenManager: TokenManager};
