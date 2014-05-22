/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var crypto = require("crypto");
var hkdf = require("./hkdf");

function Token(sessionToken) {
  if (sessionToken === undefined) {
    sessionToken = crypto.randomBytes(32).toString("hex");
  }

  this.sessionToken = sessionToken;
}

Token.prototype = {
  getCredentials: function getCredentials(callback) {
    var self = this;
    var data = new Buffer(this.sessionToken, "hex");
    hkdf(data, "sessionToken", null, 2 * 32, function(keyMaterial) {
      var tokenId = keyMaterial.slice(0, 32).toString("hex");
      var authKey = keyMaterial.slice(32, 64).toString("hex");
      callback(tokenId, authKey, self.sessionToken);
    });
  }
};

module.exports = {
  Token: Token
};
