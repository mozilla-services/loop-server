/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* jshint expr: true */
"use strict";

var expect = require("chai").expect;
var hmac = require("../loop/hmac");
var conf = require("../loop").conf;


describe("#hmac", function() {

  it("should raise on missing secret", function(done) {
    expect(function() {
        hmac("Payload");
      }).to.throw(/provide a secret./);
    done();
  });

  it("should have the same result for the same payload", function(done){
    var firstTime = hmac("Payload", conf.get("userMacSecret"));
    expect(hmac("Payload", conf.get("userMacSecret"))).to.eql(firstTime);
    done();
  });

  it("should handle the algorithm argument", function(done){
    expect(hmac(
      "Payload",
      conf.get("userMacSecret"),
      "sha1")).to.have.length(40);
    done();
  });
});
