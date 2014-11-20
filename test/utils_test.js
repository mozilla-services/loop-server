/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require('chai').expect;
var utils = require('../loop/utils');
var conf = require('../loop').conf;
var sinon = require('sinon');


describe("utils", function() {
  describe("#getProgressURL", function() {
    afterEach(function() {
      conf.set("protocol", "http");
    });

    it("should return a ws:// url if the protocol is http.", function() {
      var host = "127.0.0.1:5123";
      conf.set("protocol", "http");
      var progressURL = utils.getProgressURL(host);
      expect(progressURL).to.match(/ws:\/\//);
      expect(progressURL).to.match(/127.0.0.1:5123/);
    });

    it("should return a wss:// url if the protocol is https.", function() {
      var host = "127.0.0.1:5123";
      conf.set("protocol", "https");
      var progressURL = utils.getProgressURL(host);
      expect(progressURL).to.match(/wss:\/\//);
      expect(progressURL).to.match(/127.0.0.1:443/);
    });
  });

  describe("#now", function() {
    var clock, now;

    beforeEach(function() {
      now = Date.now()
      clock = sinon.useFakeTimers(now);
    });

    afterEach(function() {
      clock.restore();
    });

    it("should return the current timestamp", function() {
      expect(utils.now()).to.eql(parseInt(now / 1000, 10));
    });
  });
});
