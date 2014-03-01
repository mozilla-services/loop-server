/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var crypto = require("crypto");
var expect = require("chai").expect;
var sinon  = require("sinon");
var base64 = require('urlsafe-base64');
var tokenlib = require("../loop/tokenlib");


describe("TokenManager", function() {
  "use strict";

  var SECRET = "this is not a secret";
  var now = 1393595554796;
  var sandbox, clock, tokenManager;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    clock = sinon.useFakeTimers(now);

    tokenManager = new tokenlib.TokenManager(SECRET);
  });

  afterEach(function() {
    sandbox.restore();
    clock.restore();
  });

  describe("constructor", function() {

    it("should throw an error if no secret has been provided", function() {
      var noSecret;
      var failure = function() {
        return tokenlib.TokenManager(noSecret);
      };
      expect(failure).to.Throw(/TokenManager requires a 'secret' argument/);
    });

    it("should change the default timeout if provided", function() {
      var timeout = 10000; // 10 seconds
      var tokenManager = new tokenlib.TokenManager(SECRET, {timeout: timeout});
      var token = tokenManager.encode({some: "data"});

      expect(tokenManager.decode(token)).to.deep.equal({
        some: "data",
        expires: now + timeout
      });
    });
  });

  describe("#encode", function() {
    it("should return a token string", function() {
      var token = tokenManager.encode({some: "data"});
      expect(token.constructor.name).to.be.equal("String");
    });

    it("should return an base64 url safe value", function() {
      var token = tokenManager.encode({some: "data"});
      expect(base64.validate(token)).to.equal(true);
    });

    it("should parametrize the size of the token according to a given " +
      "signatureSize parameter", function() {
        var token1 = tokenManager.encode({some: "data"});
        var token2 = (new tokenlib.TokenManager("a secret", {
          signatureSize: 128/8
        })).encode({some: "data"});
        expect(token1.length < token2.length).to.equal(true);
      });

    it("should use the given digest algorithm", function() {
      sandbox.spy(crypto, "createHmac");
      (new tokenlib.TokenManager("a secret", {
        digestAlgorithm: "sha1"
      })).encode({some: "data"});

      sinon.assert.calledOnce(crypto.createHmac);
      sinon.assert.calledWith(crypto.createHmac, "sha1");
    });

    it("should add a default `expires` time", function() {
      var token = tokenManager.encode({some: "data"});

      expect(tokenManager.decode(token)).to.deep.equal({
        some: "data",
        expires: now + tokenManager.timeout
      });
    });

    it("should accept a given `expires` time", function() {
      var expires = now + 10000; // now + 10 seconds
      var token = tokenManager.encode({some: "data", expires: expires});

      expect(tokenManager.decode(token)).to.deep.equal({
        some: "data",
        expires: expires
      });
    });
  });

  describe("#decode", function() {
    it("should decode a valid encoded token", function() {
      var data = {some: "data"};
      var token = tokenManager.encode(data);

      // XXX: here, the decoded data carries more than just the `some`
      // property but also as an `expires` property. Despite this
      // fact, deep equality seems to not bother and do not fail.
      expect(tokenManager.decode(token)).to.deep.equal(data);
    });

    it("should throw an error if the signature is invalid", function() {
      var data = {some: "data"};
      var tokenForger = new tokenlib.TokenManager("h4x0r");
      var token = tokenForger.encode(data);
      var failure = function() {
        tokenManager.decode(token);
      };
      expect(failure).to.Throw(/Invalid signature/);
    });

    it("should throw an error if the token expired", function() {
      var expires = Date.now() - 10000; // now - 10 seconds
      var data = {some: "data", expires: expires};
      var token = tokenManager.encode(data);
      var failure = function() {
        tokenManager.decode(token);
      };

      expect(failure).to.Throw(/The token expired/);
    });
  });

});
