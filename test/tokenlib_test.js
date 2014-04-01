/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var crypto = require("crypto");
var expect = require("chai").expect;
var sinon  = require("sinon");
var base64 = require('urlsafe-base64');
var tokenlib = require("../loop/tokenlib");
var conf = require("../loop/config").conf;

var ONE_HOUR = 60 * 60 * 1000;

describe("TokenManager", function() {
  "use strict";

  var encryptionSecret = conf.get("encryptionSecret");
  var macSecret = conf.get("macSecret");
  var invalidEncryptionSecret = conf.get("invalidEncryptionSecret");
  var invalidMacSecret = conf.get("invalidMacSecret");

  var fakeNow = 387109; // in minutes.
  var sandbox, clock, tokenManager;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    clock = sinon.useFakeTimers(fakeNow * ONE_HOUR);

    tokenManager = new tokenlib.TokenManager({
      encryptionSecret: encryptionSecret,
      macSecret: macSecret
    });
  });

  afterEach(function() {
    sandbox.restore();
    clock.restore();
  });

  describe("constructor", function() {

    it("should throw an error if no configuration has been provided",
      function() {
      var failure = function() {
        new tokenlib.TokenManager();
      };
      expect(failure).to.Throw(/TokenManager requires an object with options/);
    });

    it("should throw an error if no macSecret has been provided",
      function() {
      var failure = function() {
        new tokenlib.TokenManager({'some': 'value'});
      };
      expect(failure).to.Throw(/requires a 'macSecret' argument/);
    });

    it("should throw an error if no encryptionSecret has been provided",
      function() {
      var failure = function() {
        new tokenlib.TokenManager({'macSecret': 'value'});
      };
      expect(failure).to.Throw(/requires an 'encryptionSecret' argument/);
    });

    it("should throw an error if the MAC size is too small", function() {
      var failure = function() {
        new tokenlib.TokenManager({
          encryptionSecret: encryptionSecret,
          macSecret: macSecret,
          macSize: 16 / 8
        });
      };
      expect(failure).to.Throw(/macSize should be no less than 4 bytes/);
    });

    it("should throw an error if the encryption secret size is too small",
    function() {
      var failure = function() {
        new tokenlib.TokenManager({
          encryptionSecret: crypto.randomBytes(15),
          macSecret: macSecret
        });
      };

      expect(failure).to.Throw(
        /encryptionSecret should be no less than 16 bytes/);
    });

    it("should throw an error if the MAC secret is shorter than the " +
       "encryption secret", function() {
      var failure = function() {
        new tokenlib.TokenManager({
          encryptionSecret: crypto.randomBytes(16),
          macSecret: crypto.randomBytes(15),
        });
      };
      expect(failure).to.Throw(/macSecret must be at least as long as/);
    });

    it("should change the default timeout if provided", function() {
      var timeout = 10; // 10 minutes
      var tokenManager = new tokenlib.TokenManager({
        encryptionSecret: encryptionSecret,
        macSecret: macSecret,
        timeout: timeout
      });
      var tokenWrapper = tokenManager.encode({some: "data"});

      expect(tokenManager.decode(tokenWrapper.token)).to.deep.equal({
        some: "data",
        expires: fakeNow + timeout
      });
      expect(tokenWrapper.payload.expires).eql(fakeNow + timeout);
    });
  });

  describe("#encode", function() {
    it("should return a token string", function() {
      var token = tokenManager.encode({some: "data"}).token;
      expect(token.constructor.name).to.be.equal("String");
    });

    it("should return a payload argument", function() {
      var payload = tokenManager.encode({some: "data"}).payload;
      expect(payload.constructor.name).to.be.equal("Object");
    });

    it("should return a payload with the decoded data", function() {
      var payload = tokenManager.encode({some: "data"}).payload;
      expect(payload).to.deep.eql({
        some: "data",
        expires: fakeNow + tokenManager.timeout
      });
    });

    it("should return an base64 url safe value", function() {
      var token = tokenManager.encode({some: "data"}).token;
      expect(base64.validate(token)).to.equal(true);
    });

    it("should parametrize the size of the token according to a given " +
      "macSize parameter", function() {
        var token1 = tokenManager.encode({some: "data"}).token;
        var token2 = (new tokenlib.TokenManager({
          encryptionSecret: encryptionSecret,
          macSecret: macSecret,
          macSize: 128 / 8
        })).encode({some: "data"}).token;
        expect(token1.length < token2.length).to.equal(true);
      });

    it("should use the given digest algorithm", function() {
      sandbox.spy(crypto, "createHmac");
      (new tokenlib.TokenManager({
        encryptionSecret: encryptionSecret,
        macSecret: macSecret,
        digestAlgorithm: "sha1"
      })).encode({some: "data"});

      sinon.assert.calledOnce(crypto.createHmac);
      sinon.assert.calledWith(crypto.createHmac, "sha1");
    });

    it("should add a default `expires` time", function() {
      var token = tokenManager.encode({some: "data"}).token;

      expect(tokenManager.decode(token)).to.deep.equal({
        some: "data",
        expires: fakeNow + tokenManager.timeout
      });
    });

    it("should accept a given `expires` time", function() {
      var expires = fakeNow + 10000; // now + 2 months (expired)
      var token = tokenManager.encode({some: "data", expires: expires});

      expect(tokenManager.decode(token.token)).to.deep.equal({
        some: "data",
        expires: expires
      });

      expect(token.payload.expires).to.deep.equal(expires);
    });
  });

  describe("#decode", function() {
    it("should decode a valid encoded token", function() {
      var data = {some: "data"};
      var token = tokenManager.encode(data).token;

      // XXX: here, the decoded data carries more than just the `some`
      // property but also as an `expires` property. Despite this
      // fact, deep equality seems to not bother and do not fail.
      expect(tokenManager.decode(token)).to.deep.equal(data);
    });

    it("should throw an error if the token is not long enough", function() {
      var tokenManager = new tokenlib.TokenManager({
        encryptionSecret: encryptionSecret,
        macSecret: macSecret
      });
      var token = base64.encode(crypto.randomBytes(15 + tokenManager.macSize));

      var failure = function() {
        tokenManager.decode(token);
      };
      expect(failure).to.Throw(/Invalid token size/);
    });

    it("should throw an error if the MAC secret is invalid", function() {
      var data = {some: "data"};
      var tokenForger = new tokenlib.TokenManager({
        encryptionSecret: encryptionSecret,
        macSecret: invalidMacSecret
      });
      var token = tokenForger.encode(data).token;
      var failure = function() {
        tokenManager.decode(token);
      };
      expect(failure).to.Throw(/Invalid MAC/);
    });

    it("should throw an error if the encryption secret is invalid", function() {
      var data = {some: "data"};
      var tokenForger = new tokenlib.TokenManager({
        encryptionSecret: invalidEncryptionSecret,
        macSecret: macSecret
      });
      var token = tokenForger.encode(data).token;
      var failure = function() {
        tokenManager.decode(token);
      };
      expect(failure).to.Throw(/Invalid payload/);
    });

    it("should throw an error if the token expired", function() {
      var tenHoursAgo = (Date.now() / ONE_HOUR) - 10;
      var data = {some: "data", expires: tenHoursAgo};
      var token = tokenManager.encode(data).token;
      var failure = function() {
        tokenManager.decode(token);
      };

      expect(failure).to.Throw(/The token expired/);
    });
  });

});
