/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var expect = require("chai").expect;
var request = require("request");
var sinon = require("sinon");
var assert = sinon.assert;

var SimplePush = require("../loop/simplepush");


describe("simplePush object", function() {
    var requests, sandbox;

    beforeEach(function() {
      requests = [];
      sandbox = sinon.sandbox.create();

      sandbox.stub(request, "put", function(options, callback) {
        requests.push(options);
        callback(undefined);
      });
    });

    afterEach(function(){
      sandbox.restore();
    });

    it("should do a put on each of the given URLs", function() {
      var simplePush = new SimplePush();
      simplePush.notify("reason", ["url1", "url2"], 12345);
      expect(requests).to.length(2);
    });

    it("should dedupe urls before using them", function() {
      var simplePush = new SimplePush();
      simplePush.notify("reason", ["url1", "url2", "url1"], 12345);
      expect(requests).to.length(2);
    });

    it("should work even if only one url is passed", function() {
      var simplePush = new SimplePush();
      simplePush.notify("reason", "url1", 12345);
      expect(requests).to.length(1);
    });

    it("should send the version when doing the request", function() {
      var simplePush = new SimplePush();
      simplePush.notify("reason", "url1", 12345);
      expect(requests).to.length(1);
      expect(requests[0].form.version).to.eql(12345);
    });

    it("should notify using the statsd client if present", function() {
      var statsdClient = { count: function() {} };
      var statsdSpy = sandbox.spy(statsdClient, "count");

      var simplePush = new SimplePush(statsdClient);
      simplePush.notify("reason", "url1", 12345);

      assert.callCount(statsdSpy, 4);
      assert.calledWithExactly(statsdSpy, "loop.simplepush.call.reason", 1);
      assert.calledWithExactly(statsdSpy, "loop.simplepush.call", 1);
      assert.calledWithExactly(statsdSpy, "loop.simplepush.call.success", 1);
      assert.calledWithExactly(statsdSpy, "loop.simplepush.call.reason.success", 1);
    });

    it("should notify using the statsd client for errors if present", function() {
      // Change request stub.
      sandbox.restore();
      sandbox = sinon.sandbox.create();

      sandbox.stub(request, "put", function(options, callback) {
        requests.push(options);
        callback("error");
      });

      var statsdClient = { count: function() {} };
      var statsdSpy = sandbox.spy(statsdClient, "count");

      var simplePush = new SimplePush(statsdClient);
      simplePush.notify("reason", "url1", 12345);

      assert.callCount(statsdSpy, 4);
      assert.calledWithExactly(statsdSpy, "loop.simplepush.call.reason", 1);
      assert.calledWithExactly(statsdSpy, "loop.simplepush.call", 1);
      assert.calledWithExactly(statsdSpy, "loop.simplepush.call.failures", 1);
      assert.calledWithExactly(statsdSpy, "loop.simplepush.call.reason.failures", 1);
    });
});
