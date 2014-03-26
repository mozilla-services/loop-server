/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var OpenTok = require('opentok');

function TokBox(settings) {
  this.serverIP = settings.serverIP;
  this.apiKey = settings.apiKey;
  this.tokenDuration = settings.tokenDuration;
  this._opentok = new OpenTok.OpenTokSDK(this.apiKey, settings.apiSecret);
}

TokBox.prototype = {
  getSessionTokens: function(cb) {
    var self = this;
    this._opentok.createSession(
      this.serverIP, {'p2p.preference':'enabled'}, function(err, sessionId) {
        if (err || sessionId === undefined || sessionId === null) {
          cb(err || new Error("Got an empty sessionId from tokbox, check " +
                              "your credentials."));
          return;
        }
        var now = Math.round(new Date().getTime() / 1000.0);
        var expirationTime = now + self.tokenDuration;
        cb(null, {
          sessionId: sessionId,
          callerToken: self._opentok.generateToken({
            session_id: sessionId,
            role: OpenTok.RoleConstants.PUBLISHER,
            expire_time: expirationTime
          }),
          calleeToken: self._opentok.generateToken({
            session_id: sessionId,
            role: OpenTok.RoleConstants.PUBLISHER,
            expire_time: expirationTime
          })
        });
      }
    );
  }
};

module.exports = {
  TokBox: TokBox,
  OpenTok: OpenTok
};
