/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var crypto = require("crypto");
var base64 = require('urlsafe-base64');
var ONE_HOUR = 60 * 60 * 1000;

/**
 * Token manager (returned tokens are opaque to the user).
 *
 * @param {Object} options, can contain the following options:
 *
 *  - {String} macSecret, 32 bytes key encoded as hexadecimal
 *  - {String} encryptionSecret, 32 bytes key encoded as hexadecimal
 *  - {Number} macSize, in bytes.
 *  - {String} cipherAlgorithm for ciphering the data.
 *  - {String} digestAlgorithm for HMAC computation.
 *  - {String} timeout, in hours.
 **/
function TokenManager(options) {
  if (!options)
    throw new Error("TokenManager requires an object with options");

  if (!options.macSecret)
    throw new Error("TokenManager requires a 'macSecret' argument");
  if (!options.encryptionSecret)
    throw new Error("TokenManager requires an 'encryptionSecret' argument");

  this.macSecret = new Buffer(options.macSecret, "hex");
  this.encryptionSecret = new Buffer(options.encryptionSecret, "hex");

  this.macSize = options.macSize || 4;

  if (this.encryptionSecret.length < 16)
    throw new Error("encryptionSecret should be no less than 16 bytes");

  if (this.macSize < 4)
    throw new Error("macSize should be no less than 4 bytes");

  if (this.macSecret.length < this.encryptionSecret.length)
    throw new Error("macSecret must be at least as long as " +
                    "encryptionSecret");

  this.cipherAlgorithm = options.cipherAlgorithm || "aes-128-cbc";
  this.digestAlgorithm = options.digestAlgorithm || "sha256";
  this.timeout = options.timeout || 24 * 30; // one month, in hours.
}

TokenManager.prototype = {

  /**
   * Encode the given data.
   *
   * Returns an object with two keys:
   *  - token, the encoded token;
   *  - payload, the data contained inside the token (it may contain additional
                 data than the one passed in the argument)
   */
  encode: function(data) {
    var payload, mac, hmac, cipher, encipheredPayload;
    var expires = data.expires || (Date.now() / ONE_HOUR) + this.timeout;
    data.expires = Math.round(expires);

    payload = new Buffer(JSON.stringify(data));

    var IV = crypto.randomBytes(16);
    // Cipher the payload.
    cipher = crypto.createCipheriv(
      this.cipherAlgorithm,
      this.encryptionSecret,
      IV
    );
    cipher.write(payload);
    cipher.end();

    encipheredPayload = cipher.read();

    // Get the MAC of the encrypted payload.
    hmac = crypto.createHmac(this.digestAlgorithm, this.macSecret);
    hmac.write(encipheredPayload);
    hmac.end();

    // keep the first `macSize` bytes only, so we avoid huge MAC
    mac = hmac.read().slice(0, this.macSize);

    return {
      payload: data,
      token: base64.encode(Buffer.concat([IV, encipheredPayload, mac]))
    };
  },

  decode: function(token) {
    var mac, encipheredPayload, payload, hmac, payloadMac, decipher, IV;

    token = base64.decode(token);
    if (token.length < (16 + this.macSize))
      throw new Error("Invalid token size");
    // Split token into <IV: 16 bytes><payload><mac: macSize bytes>
    IV = token.slice(0, 16);
    encipheredPayload = token.slice(16, token.length - this.macSize);
    mac = token.slice(token.length - this.macSize);

    hmac = crypto.createHmac(this.digestAlgorithm, this.macSecret);
    hmac.write(encipheredPayload);
    hmac.end();

    // The MAC is the first `macSize` bits only
    payloadMac = hmac.read().slice(0, this.macSize);

    if (mac.toString() !== payloadMac.toString()){
      throw new Error("Invalid MAC");
    }

    decipher = crypto.createDecipheriv(
      this.cipherAlgorithm,
      this.encryptionSecret,
      IV
    );
    decipher.write(encipheredPayload);
    try {
      decipher.end();
    } catch(e) {
      throw "Invalid payload";
    }
    payload = decipher.read();

    var data = JSON.parse(payload);
    if (data.expires * ONE_HOUR < Date.now())
      throw new Error("The token expired");

    return data;
  }
};


module.exports = {
  TokenManager: TokenManager,
  ONE_HOUR: ONE_HOUR
};
