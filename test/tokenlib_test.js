/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var tokenlib = require("../loop/tokenlib");

describe("tokenlib", function() {
  describe("#generateToken", function() {
    it("should return a token of [a-zA-Z0-9_-].", function() {
      var shortToken, s = 10;
      while (s > 0) {
        shortToken = tokenlib.generateToken(s);
        expect(shortToken).to.match(/^[a-zA-Z0-9\-_]+$/);
        s--;
      }
    });
  });
});
