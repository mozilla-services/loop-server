/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var TokBox = require("../loop/tokbox").TokBox;
var OpenTok = require("../loop/tokbox").OpenTok;
var conf = require("../loop/config").conf;

var sinon = require("sinon");
var expect = require("chai").expect;

var assert = sinon.assert;

describe("TokBox", function() {
  var sandbox, apiSecret, apiKey, serverIP, fakeCallInfo;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    var tokBoxConfig = conf.get('tokBox');
    fakeCallInfo = conf.get('fakeCallInfo');
    apiSecret = tokBoxConfig.apiSecret;
    apiKey = tokBoxConfig.apiKey;
    serverIP = tokBoxConfig.serverIP;
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe("#constructor", function() {
    it("should create an OpenTok object with info from settings", function() {
      sandbox.stub(OpenTok, "OpenTokSDK");

      new TokBox({
        apiKey: apiKey,
        apiSecret: apiSecret,
        serverIP: serverIP,
        tokenDuration: 3600
      });
      assert.calledOnce(OpenTok.OpenTokSDK);
      assert.calledWithExactly(OpenTok.OpenTokSDK, apiKey, apiSecret);
    });
  });

  describe("#getSessionTokens", function() {
    var tokBox;

    beforeEach(function() {
      tokBox = new TokBox({
        apiKey: apiKey,
        apiSecret: apiSecret,
        serverIP: serverIP,
        tokenDuration: 3600 // 1h.
      });
    });

    it("should return session and token info if tokbox API are working",
    function(done) {
      sandbox.stub(tokBox._opentok, "createSession",
      function(location, options, cb) {
        cb(null, fakeCallInfo.session1);
      });

      var generateTokenCalls = 0;
      sandbox.stub(tokBox._opentok, "generateToken", function(options) {
        generateTokenCalls += 1;
        if (generateTokenCalls === 1) {
          return fakeCallInfo.token1;
        }
        return fakeCallInfo.token2;
      });

      tokBox.getSessionTokens(function(error, info) {
        expect(error).eql(null);
        expect(info).eql({
          sessionId: fakeCallInfo.session1,
          callerToken: fakeCallInfo.token1,
          calleeToken: fakeCallInfo.token2
        });

        assert.calledOnce(tokBox._opentok.createSession);
        assert.calledTwice(tokBox._opentok.generateToken);
        done();
      });
    });

    it("should error out if the tokbox API doesn't work", function(done) {
      sandbox.stub(tokBox._opentok, "createSession",
        function(location, options, cb) {
          cb("error");
        });
      tokBox.getSessionTokens(function(error, info) {
        expect(error).eql("error");
        done();
      });
    });
  });
});
