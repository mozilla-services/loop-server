/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var OpenTok = require('opentok');

function TokBox(settings) {
  this.serverIP = settings.serverIP;
  this.apiKey = settings.apiKey;
  this._opentok = new OpenTok.OpenTokSDK(this.apiKey, settings.apiSecret);
}

TokBox.prototype = {
  "getInfo": function(cb) {
    var that = this;
    this._opentok.createSession(
      this.serverIP, {'p2p.preference':'enabled'}, function(err, sessionId) {
        if (err) {
          cb(err);
          return;
        }
        cb(null, {
          sessionId: sessionId,
          callerToken: that._opentok.generateToken({
            session_id: sessionId,
            role: OpenTok.RoleConstants.PUBLISHER
          }),
          calleeToken: that._opentok.generateToken({
            session_id: sessionId,
            role: OpenTok.RoleConstants.PUBLISHER
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
