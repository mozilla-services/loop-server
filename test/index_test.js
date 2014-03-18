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

    it("should have the same result for the same payload", function(){
      var firstTime = hmac("Payload");
      expect(hmac("Payload")).to.eql(firstTime);
    });

    it("should handle an algorithm change", function(){
      var previousAlgorithm = conf.get("userMacAlgorithm");
      conf.set("userMacAlgorithm", "sha1");
      expect(hmac("Payload")).to.have.length(40);
      conf.set("userMacAlgorithm", previousAlgorithm);
    });
  });

  describe("#validateSimplePushURL", function(){
    it("should receive an object", function(){
      expect(validateSimplePushURL).to.throw(/missing request data/);
    });

    it("should receive a SimplePush URL", function(){
      expect(function(){
        validateSimplePushURL({});
      }).to.throw(/simple_push_url is required/);
    });

    it("should receive a valid HTTP URL", function(){
      expect(function(){
        validateSimplePushURL({simple_push_url: "Wrong URL"});
      }).to.throw(/simple_push_url should be a valid url/);
    });

    it("should handle valid SimplePush URL", function(){
      expect(validateSimplePushURL({
        simple_push_url: "http://www.mozilla.org"
      })).to.eql({
        simple_push_url: "http://www.mozilla.org"
      });
    });
  });
});
