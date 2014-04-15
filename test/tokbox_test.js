/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var TokBox = require("../loop/tokbox").TokBox;
var FakeTokBox = require("../loop/tokbox").FakeTokBox;
var request = require("../loop/tokbox").request;
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

    it("should error in a special way if the returned session is empty",
      function(done) {
        sandbox.stub(tokBox._opentok, "createSession",
          function(location, options, cb) {
            cb();
          });
        tokBox.getSessionTokens(function(error, info) {
          expect(error).eql(/check your credentials/);
          done();
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
        requests.push(options);
        cb(null);
      });
      tokbox = new FakeTokBox();
    });

    afterEach(function() {
      sandbox.restore();
    });


    it("should return new session and tokens.", function(done) {
      tokbox.getSessionTokens(function(err, credentials) {
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
        expect(requests).to.have.length(1);
        expect(requests[0]).to.equal(conf.get("fakeTokBoxURL"));
        done();
      });
    });    
  });
});
