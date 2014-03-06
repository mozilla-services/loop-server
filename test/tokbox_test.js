/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var TokBox = require("../loop/tokbox").TokBox;
var OpenTok = require("../loop/tokbox").OpenTok;
var conf = require("../loop/config");

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
      var stub = sandbox.stub(OpenTok, "OpenTokSDK");

      new TokBox({apiKey: apiKey, apiSecret: apiSecret, serverIP: serverIP});
      assert.calledOnce(stub);
      assert.calledWithExactly(stub, apiKey, apiSecret);
    });
  });

  describe("#getInfo", function() {
    var tokBox;

    beforeEach(function() {
      tokBox = new TokBox({
        apiKey: apiKey,
        apiSecret: apiSecret,
        serverIP: serverIP
      });
    });

    it("should return session and token info if tokbox API are working",
    function(done) {
      var createSessionStub = sandbox.stub(tokBox._opentok, "createSession",
      function(location, options, cb) {
        cb(null, fakeCallInfo.session1);
      });

      var generateTokenCalls = 0;
      var generateTokenStub = sandbox.stub(tokBox._opentok, "generateToken",
      function(options) {
        generateTokenCalls += 1;
        if(generateTokenCalls === 1) {
          return fakeCallInfo.token1;
        } else {
          return fakeCallInfo.token2;
        }
      });

      tokBox.getInfo(function(error, info) {
        expect(error).eql(null);
        expect(info).eql({
          sessionId: fakeCallInfo.session1,
          callerToken: fakeCallInfo.token1,
          calleeToken: fakeCallInfo.token2
        });

        assert.calledOnce(createSessionStub);
        assert.calledTwice(generateTokenStub);
        done();
      });
    });

    it("should error out if the tokbox API doesn't work", function(done) {
      sandbox.stub(tokBox._opentok, "createSession",
      function(location, options, cb) {
        cb("error");
      });
      tokBox.getInfo(function(error, info) {
        expect(error).eql("error");
        done();
      });
    });


  });
});
