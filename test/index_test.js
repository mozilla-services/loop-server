/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var conf = require("../loop").conf;
var hmac = require("../loop").hmac;
var validateSimplePushURL = require("../loop").validateSimplePushURL;

describe("index", function() {
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

  describe("#validateSimplePushURL", function(){
    it("should receive an object", function(done){
      expect(validateSimplePushURL).to.throw(/missing request data/);
      done();
    });

    it("should receive a SimplePush URL", function(done){
      expect(function(){
        validateSimplePushURL({});
      }).to.throw(/simple_push_url is required/);
      done();
    });

    it("should receive a valid HTTP URL", function(done){
      expect(function(){
        validateSimplePushURL({simple_push_url: "Wrong URL"});
      }).to.throw(/simple_push_url should be a valid url/);
      done();
    });

    it("should handle valid SimplePush URL", function(done){
      expect(validateSimplePushURL({
        simple_push_url: "http://www.mozilla.org"
      })).to.eql({
        simple_push_url: "http://www.mozilla.org"
      });
      done();
    });
  });
});
