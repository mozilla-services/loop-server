/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var config = require("../loop/config");

describe("config", function() {
  describe("#validateKeys", function() {
    it("should throw an error if a key is missing", function() {
      expect(function() {
        config.validateKeys(['foo'])({});
      }).to.throw(/Should have a foo property/);
    });

    it("should not throw if all keys are valid", function() {
      config.validateKeys(['foo'])({foo: 'oh yeah'});
    });

    it("should not throw any error if it is defined as optional", function() {
      config.validateKeys(['foo'], {'optional': true})({});
    });
  });

  describe("#hexKeyOfSize", function() {
    it("should check if all chars are hexadecimals", function() {
      expect(function() {
        config.hexKeyOfSize(4)("ggggaaaa");
      }).to.throw(/Should be an 4 bytes key encoded as hexadecimal/);
    });

    it("should check the size of the given key", function() {
      expect(function() {
        config.hexKeyOfSize(4)("aaaafff");
      }).to.throw(/Should be an 4 bytes key encoded as hexadecimal/);
    });
  });

  describe("sample.json", function() {
    it("should load.", function() {
      require("../config/sample.json");
    });
  });
});
