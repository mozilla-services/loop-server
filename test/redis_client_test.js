/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var expect = require("chai").expect;
var sinon = require("sinon");

var redis_client = require("../loop/storage/redis_client");

describe("redis_client", function() {
  var sandbox;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe("createClient", function() {
    it("should return an object", function() {
      expect(redis_client.createClient(6379, "localhost")).to.be.an("object");
    });

    it("should let default multi support with sharding disabled",
      function(done) {
        var client = redis_client.createClient(6379, "localhost", {
          sharding: false
        });
        var stub = sandbox.stub(client, "set", function(key, value, cb) {
          cb();
        });

        var multi = client.multi();
        multi.set("foo", "foo");
        multi.set("bar", "bar");
        multi.exec(function(err) {
          sinon.assert.notCalled(stub);
          done(err);
        });
    });

    describe("#multi", function() {
      var client;
      beforeEach(function() {
        client = redis_client.createClient(6379, "localhost", {
          sharding: true
        })
      });

      it("should return an object", function() {
        expect(client.multi()).to.be.an("object");
      });

      it("should expose supported multi operations", function() {
        var multi = client.multi();
        expect(Object.getPrototypeOf(multi))
          .to.include.keys(redis_client.MULTI_OPERATIONS);
      });

      it("should stack multi operations and execute them", function(done) {
        sandbox.stub(client, "set", function(key, value, cb) {
          cb();
        });

        var multi = client.multi();
        multi.set("foo", "foo");
        multi.set("bar", "bar");
        multi.exec(function(err) {
          sinon.assert.calledTwice(client.set);
          done(err);
        });
      });

      it("should return a list of operations responses", function(done) {
        var set = sandbox.stub(client, "set", function(key, value, cb) {
          cb(null, value);
        });

        var multi = client.multi();
        multi.set("foo", "foo");
        multi.set("bar", "bar");
        multi.exec(function(err) {
          sinon.assert.calledTwice(client.set);
          expect(set.getCall(0).args[0]).to.eql("foo");
          expect(set.getCall(1).args[0]).to.eql("bar");
          done(err);
        });
      });
    })
  });
});
