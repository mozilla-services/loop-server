/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var loopTokbox = require("../loop/tokbox");
var TokBox = require("../loop/tokbox").TokBox;
var FakeTokBox = require("../loop/tokbox").FakeTokBox;
var request = require("../loop/tokbox").request;
var conf = require("../loop/config").conf;

var sinon = require("sinon");
var expect = require("chai").expect;

var assert = sinon.assert;

describe("TokBox", function() {
  var sandbox, apiSecret, apiKey, apiUrl, fakeCallInfo, releaseUrl;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    var tokBoxConfig = conf.get('tokBox');
    fakeCallInfo = conf.get('fakeCallInfo');
    apiSecret = tokBoxConfig.credentials.default.apiSecret;
    apiKey = tokBoxConfig.credentials.default.apiKey;
    apiUrl = "https://api.opentok.com";
    releaseUrl = "https://release.opentok.com";
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe("#constructor", function() {
    it("should create an OpenTok object with info from settings", function() {
      sandbox.stub(loopTokbox, "OpenTok");

      new TokBox({
        credentials: {
          default : {
            apiKey: apiKey,
            apiSecret: apiSecret
          }
        },
        tokenDuration: 3600,
        timeout: 2000
      });
      assert.calledOnce(loopTokbox.OpenTok);
      assert.calledWithExactly(loopTokbox.OpenTok, apiKey,
                               apiSecret, {apiUrl: apiUrl, timeout: 2000});
    });

    it("should create an OpenTok object and override the apiUrl", function() {
      sandbox.stub(loopTokbox, "OpenTok");

      new TokBox({
        credentials: {
          default: {
            apiKey: apiKey,
            apiSecret: apiSecret,
            apiUrl: "http://test"
          }
        },
        tokenDuration: 3600,
        timeout: 1500
      });
      assert.calledOnce(loopTokbox.OpenTok);
      assert.calledWithExactly(loopTokbox.OpenTok, apiKey,
                               apiSecret, {apiUrl: "http://test", timeout: 1500});
    });
  });

  describe("#getSessionTokens", function() {
    var tokBox, openTokSpy;

    beforeEach(function() {
      openTokSpy = sandbox.spy(loopTokbox, "OpenTok");
      openTokSpy.withArgs(
        apiKey + "_nightly",
        apiSecret + "_nightly",
        apiUrl
      );

      openTokSpy.withArgs(
        apiKey + "_release",
        apiSecret + "_release",
        releaseUrl
      );

      tokBox = new TokBox({
        credentials: {
          nightly: {
            apiKey: apiKey + "_nightly",
            apiSecret: apiSecret + "_nightly"
          },
          release: {
            apiKey: apiKey + "_release",
            apiSecret: apiSecret + "_release",
            apiUrl: releaseUrl
          },
          default: {
            apiKey: apiKey,
            apiSecret: apiSecret
          }
        },
        tokenDuration: 3600, // 1h.
        timeout: 2000
      });
    });

    it("should return session and token info if tokbox API are working",
    function(done) {
      sandbox.stub(tokBox._opentok.default, "createSession",
      function(options, cb) {
        cb(null, {sessionId: fakeCallInfo.session1});
      });

      var generateTokenCalls = 0;
      sandbox.stub(tokBox._opentok.default, "generateToken",
        /* eslint-disable */
        function(sessionId, options) {
          generateTokenCalls += 1;
          if (generateTokenCalls === 1) {
            return fakeCallInfo.token1;
          }
          return fakeCallInfo.token2;
        });
        /* eslint-enable */

      tokBox.getSessionTokens(function(error, info) {
        expect(error).eql(null);
        expect(info).eql({
          apiKey: apiKey,
          sessionId: fakeCallInfo.session1,
          callerToken: fakeCallInfo.token1,
          calleeToken: fakeCallInfo.token2
        });

        assert.calledOnce(tokBox._opentok.default.createSession);
        assert.calledTwice(tokBox._opentok.default.generateToken);
        done();
      });
    });

    it("should error out if the tokbox API doesn't work", function(done) {
      sandbox.stub(tokBox._opentok.default, "createSession",
        function(options, cb) {
          cb("error");
        });
      tokBox.getSessionTokens(function(error) {
        expect(error).eql("error");
        assert.calledThrice(tokBox._opentok.default.createSession);
        done();
      });
    });

    it("should use the default credentials if the channel is not known",
      function(done) {
        sandbox.stub(tokBox._opentok.default, "createSession",
          function(options, cb) {
            cb(null, {sessionId: fakeCallInfo.session1});
          });
        tokBox.getSessionTokens({
          channel: "unknown"
        }, function(error, info) {
          expect(info).to.eql({
            apiKey: apiKey,
            sessionId: fakeCallInfo.session1,
            callerToken: null,
            calleeToken: null
          });
          done(error);
        });
      });

    it("should create an new client with a known channel and specific apiUrl",
      function(done) {
        sandbox.stub(tokBox._opentok.release, "createSession",
          function(options, cb) {
            cb(null, {sessionId: fakeCallInfo.session1});
          });
        tokBox.getSessionTokens({
          channel: "release"
        }, function(error) {
          expect(openTokSpy.withArgs(
            apiKey + "_release",
            apiSecret + "_release",
            {apiUrl: releaseUrl, timeout: 2000}
          ).calledOnce).to.eql(true);
          assert.calledOnce(tokBox._opentok.release.createSession);
          done(error);
        });
      });

    it("should create an new client with a known channel and default apiUrl",
      function(done) {
        sandbox.stub(tokBox._opentok.nightly, "createSession",
          function(options, cb) {
            cb(null, {sessionId: fakeCallInfo.session1});
          });
        tokBox.getSessionTokens({
          channel: "nightly"
        }, function(error) {
          expect(openTokSpy.withArgs(
            apiKey + "_nightly",
            apiSecret + "_nightly",
            {apiUrl: apiUrl, timeout: 2000}
          ).calledOnce).to.eql(true);
          assert.calledOnce(tokBox._opentok.nightly.createSession);
          done(error);
        });
      });
  });

  describe("#ping", function() {
    var tokBox, sandbox;

    beforeEach(function() {
      tokBox = new TokBox({
        credentials: {
          default: {
            apiKey: apiKey,
            apiSecret: apiSecret
          }
        },
        tokenDuration: 3600 // 1h.
      });
      sandbox = sinon.sandbox.create();

      sandbox.stub(loopTokbox.OpenTok.prototype, "createSession",
        function(options, cb) {
          cb(null);
        });
      sandbox.spy(loopTokbox, "OpenTok");
    });

    afterEach(function() {
      sandbox.restore();
    });

    it("should return null if there is no error.", function() {
      tokBox.ping({timeout: 2}, function(err) {
        expect(err).to.eql(null);
        assert.calledOnce(loopTokbox.OpenTok);
        assert.calledWithExactly(
          loopTokbox.OpenTok, apiKey,
          apiSecret, {
            apiUrl: apiUrl,
            timeout: 2
          }
        );
      });
    });
  });
});

describe("FakeTokBox", function() {
  describe("#getSessionTokens", function() {
    var tokbox, sandbox, requests;

    beforeEach(function() {
      sandbox = sinon.sandbox.create();

      requests = [];
      sandbox.stub(request, "get", function(options, cb) {
        requests.push(options.url);
        cb(null);
      });
      tokbox = new FakeTokBox();
    });

    afterEach(function() {
      sandbox.restore();
    });

    it("should expose a apiKey property.", function() {
      expect(tokbox.apiKey).eql('falseApiKey');
    });

    it("should return new session and tokens.", function(done) {
      tokbox.getSessionTokens(function(err, credentials) {
        if (err) throw err;
        // Verify sessionId
        expect(credentials.hasOwnProperty('sessionId')).to.equal(true);
        expect(credentials.sessionId).to.match(/^1_/);

        // Verify callerToken
        expect(credentials.hasOwnProperty('callerToken')).to.equal(true);
        expect(credentials.callerToken).to.match(/^T1==/);

        // Verify calleeToken
        expect(credentials.hasOwnProperty('calleeToken')).to.equal(true);
        expect(credentials.calleeToken).to.match(/^T2==/);
        done();
      });
    });

    it("should do a call to a predefined url.", function(done) {
      tokbox.getSessionTokens(function(err) {
        if (err) throw err;
        expect(requests).to.have.length(1);
        expect(requests[0]).to.equal(conf.get("fakeTokBoxURL"));
        done();
      });
    });

    it("should answer ping correctly.", function() {
      tokbox.ping({timeout: 2}, function(err) {
        expect(err).to.eql(null);
        expect(requests).to.length(1);
        expect(requests[0]).to.eql(tokbox.serverURL);
      });
    });
  });
});
