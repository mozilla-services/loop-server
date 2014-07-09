/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* jshint expr: true */
"use strict";

var expect = require("chai").expect;
var crypto = require("crypto");
var addHawk = require("superagent-hawk");
var supertest = addHawk(require("supertest"));
var sinon = require("sinon");
var assert = sinon.assert;
var fxaAuth = require("../loop/fxa");
var Token = require("../loop/token").Token;
var conf = require("../loop").conf;
var app = require("../loop").app;
var hmac = require("../loop/hmac");
var server = require("../loop").server;
var shutdown = require("../loop").shutdown;
var storage = require("../loop").storage;
var validateToken = require("../loop").validateToken;
var requireParams = require("../loop").requireParams;
var authenticate = require("../loop").authenticate;
var validateSimplePushURL = require("../loop").validateSimplePushURL;
var validateCallType = require("../loop").validateCallType;
var returnUserCallTokens = require("../loop").returnUserCallTokens;
var tokBox = require("../loop").tokBox;
var request = require("../loop").request;
var expectFormatedError = require("./support").expectFormatedError;
var errors = require("../loop/errno.json");

describe("index.js", function() {
  var jsonReq;

  beforeEach(function() {
    jsonReq = supertest(app);
  });

  describe("#hmac", function() {

    it("should raise on missing secret", function(done) {
      expect(function() {
          hmac("Payload");
        }).to.throw(/provide a secret./);
      done();
    });

    it("should have the same result for the same payload", function(done){
      var firstTime = hmac("Payload", conf.get("userMacSecret"));
      expect(hmac("Payload", conf.get("userMacSecret"))).to.eql(firstTime);
      done();
    });

    it("should handle the algorithm argument", function(done){
      expect(hmac(
        "Payload",
        conf.get("userMacSecret"),
        "sha1")).to.have.length(40);
      done();
    });
  });

  describe("#shutdown", function () {
    var sandbox;

    beforeEach(function() {
      sandbox = sinon.sandbox.create();
      sandbox.stub(process, "exit");
      sandbox.stub(server, "close", function(cb) { cb(); });
    });

    afterEach(function() {
      sandbox.restore();
    });

    it("should call #close on the server object", function(done) {
      shutdown(function() {
        sinon.assert.calledOnce(server.close);
        done();
      });
    });

    it("should call exit(0) on the process object", function(done) {
      shutdown(function() {
        sinon.assert.calledOnce(process.exit);
        sinon.assert.calledWithExactly(process.exit, 0);
        done();
      });
    });
  });

  describe("#validateToken", function(){

    // Create a route with the validateToken middleware installed.
    app.get('/validateToken/:token', validateToken, function(req, res) {
      res.json(200, "ok");
    });

    afterEach(function(done) {
      storage.drop(done);
    });

    it("should return a 404 if the token is missing.", function(done) {
      jsonReq
        .get('/validateToken/')
        .expect(404)
        .end(done);
    });

    it("should return a 404 if the token is invalid.", function(done) {
      jsonReq
        .get('/validateToken/invalidToken')
        .expect(404)
        .end(done);
    });

    it("should return a 404 if the token had been revoked", function(done) {
      storage.addUserCallUrlData("natim", "1234", {
        timestamp: Date.now(),
        expires: Date.now() + conf.get("callUrlTimeout")
      }, function(err) {
        if (err) throw err;
        storage.revokeURLToken("1234", function(err) {
          if (err) throw err;
          jsonReq
            .get('/validateToken/1234')
            .expect(404)
            .end(done);
        });
      });
    });

    it("should return a 200 if the token is valid.", function(done) {
      storage.addUserCallUrlData("natim", "1234", {
        timestamp: Date.now(),
        expires: Date.now() + conf.get("callUrlTimeout")
      }, function(err) {
        if (err) throw err;
        jsonReq
          .get('/validateToken/1234')
          .expect(200, /ok/)
          .end(done);
      });
    });
  });

  describe("#validateSimplePushURL", function() {
    // Create a route with the validateSimplePushURL middleware installed.
    app.post('/validateSP/', validateSimplePushURL, function(req, res) {
      res.json(200, "ok");
    });

    it("should validate the simple push url", function(done) {
      jsonReq
        .post('/validateSP/')
        .send({'simplePushURL': 'not-an-url'})
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
                              "simplePushURL should be a valid url");
          done();
        });
    });

    it("should work with a valid simple push url", function(done) {
      jsonReq
        .post('/validateSP/')
        .send({'simplePushURL': 'http://this-is-an-url'})
        .expect(200)
        .end(function(err, res) {
          console.log(res.text);
          done(err);
        });
    });

  });

  describe("#validateCallType", function() {
    // Create a route with the validateSimplePushURL middleware installed.
    app.post('/validateCallType/', validateCallType, function(req, res) {
      res.json(200, "ok");
    });

    it("should error on empty callType", function(done) {
      jsonReq
        .post('/validateCallType/')
        .send({})
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                              "Missing: callType");
          done();
        });
    });

    it("should error on wrong callType", function(done) {
      jsonReq
        .post('/validateCallType/')
        .send({'callType': 'wrong-type'})
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
                              "callType should be 'audio' or 'audio-video'");
          done();
        });
    });

    it("should accept a valid 'audio' callType", function(done) {
      jsonReq
        .post('/validateCallType/')
        .send({callType: 'audio'})
        .expect(200)
        .end(done);
    });

    it("should accept a valid'audio-video' callType", function(done) {
      jsonReq
        .post('/validateCallType/')
        .send({callType: 'audio-video'})
        .expect(200)
        .end(done);
    });

  });

  describe("#requireParams", function(){
    // Create a route with the requireParams middleware installed.
    app.post('/requireParams/', requireParams('a', 'b'), function(req, res) {
      res.json(200, "ok");
    });

    app.post('/requireParams/simplePushURL', requireParams('simplePushURL'),
      function(req, res) {
        res.json(200, "ok");
      });

    it("should return a 406 if the body is not in JSON.", function(done) {
      jsonReq
        .post('/requireParams/')
        .set('Accept', 'text/html')
        .expect(406, /json/)
        .end(done);
    });

    it("should accept simple_push_url when requesting simplePushURL.",
      function(done) {
        jsonReq
          .post('/requireParams/simplePushURL')
          .send({simple_push_url: "http://deny"})
          .expect(200)
          .end(done);
      });

    it("should return a 400 if one of the required params are missing.",
      function(done) {
        jsonReq
          .post('/requireParams/')
          .send({a: "Ok"})
          .expect(400)
          .end(function(err, res) {
            if (err) throw err;
            expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                                "Missing: b");
            done();
          });
      });

    it("should return a 400 if all params are missing.", function(done) {
      jsonReq
        .post('/requireParams/')
        .send({})
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                              "Missing: a, b");
          done();
        });
    });

    it("should return a 200 if all the params are presents.", function(done) {
      jsonReq
        .post('/requireParams/')
        .send({a: "Ok", b: "Ok"})
        .expect(200)
        .end(done);
    });
  });

  describe("authentication middleware", function() {
    var expectedAssertion, sandbox, user;
    user = "alexis";

    app.post("/with-authenticate", authenticate, function(req, res) {
      res.json(200, {});
    });

    describe("BrowserID", function() {
      beforeEach(function() {
        sandbox = sinon.sandbox.create();
        expectedAssertion = "BID-ASSERTION";

        // Mock the calls to the external BrowserID verifier.
        sandbox.stub(fxaAuth, "verifyAssertion",
          function(assertion, audience, trustedIssuers, cb){
            if (assertion === expectedAssertion) {
              cb(null, {idpClaims: {"fxa-verifiedEmail": user}});
            } else {
              cb("error");
            }
          });
      });

      afterEach(function() {
        sandbox.restore();
      });

      it("should accept assertions and return hawk credentials",
        function(done) {
          supertest(app)
            .post("/with-authenticate")
            .set('Authorization', 'BrowserID ' + expectedAssertion)
            .expect(200)
            .end(function(err, res) {
              expect(res.header['hawk-session-token']).to.not.be.undefined;
              done();
            });
        });

      it("shouldn't accept invalid assertions", function(done) {
          supertest(app)
            .post("/with-authenticate")
            .set('Authorization', 'BrowserID wrongAssertion')
            .expect(401)
            .end(done);
        });
    });

    describe("Hawk", function() {
      var hawkCredentials, userHmac;

      beforeEach(function(done) {
        // Generate Hawk credentials.
        var token = new Token();
        token.getCredentials(function(tokenId, authKey) {
          hawkCredentials = {
            id: tokenId,
            key: authKey,
            algorithm: "sha256"
          };
          userHmac = hmac(tokenId, conf.get('hawkIdSecret'));
          storage.setHawkSession(userHmac, authKey, done);
        });
      });

      it("should accept valid hawk sessions", function(done) {
          supertest(app)
            .post("/with-authenticate")
            .hawk(hawkCredentials)
            .expect(200)
            .end(done);
        });

      it("shouldn't accept invalid hawk credentials", function(done) {
          hawkCredentials.id = crypto.randomBytes(16).toString("hex");
          supertest(app)
            .post("/with-authenticate")
            .hawk(hawkCredentials)
            .expect(401)
            .end(function(err, res) {
              done();
            });
        });
      it("should update session expiration time on auth", function(done) {
        sandbox.spy(storage, "touchHawkSession");
        supertest(app)
          .post("/with-authenticate")
          .hawk(hawkCredentials)
          .expect(200)
          .end(function(err) {
            if (err) {
              throw err;
            }
            assert.calledWithExactly(
              storage.touchHawkSession,
              userHmac
            );
            done();
          });
      });
    });

    it("should generate new hawk sessions if no authentication is provided",
      function(done) {
        supertest(app)
          .post("/with-authenticate")
          .expect(200)
          .end(function(err, res) {
            expect(res.header['hawk-session-token']).to.not.be.undefined;
            expect(res.header['hawk-session-token']).to.length(64);
            done();
          });
      });
  });

  describe("#returnUserCallTokens", function() {
    var sandbox;

    app.post('/returnUserCallTokens', function(req, res) {
      returnUserCallTokens({
        callerId: req.body.callerId,
        calleeFriendlyName: req.body.calleeFriendlyName,
        callToken: req.body.callToken,
        callType: req.body.callType
      }, function(err, callTokens) {
        if(res.serverError(err)) return;

        res.json(200, callTokens);
      });
    });

    beforeEach(function() {
      sandbox = sinon.sandbox.create();
    });

    afterEach(function() {
      sandbox.restore();
    });

    it("should return a 503 if tokbox API errors out", function(done) {
      sandbox.stub(tokBox, "getSessionTokens", function(cb) {
        cb("error");
      });

      supertest(app)
        .post('/returnUserCallTokens')
        .send({callType: "audio"})
        .expect(503)
        .end(done);
    });

    describe("With working tokbox APIs", function() {

      var callerId = "aCallerId";
      var calleeFriendlyName = "issuerName";
      var callToken = 'call-token';
      var tokBoxSessionId = "aTokboxSession";
      var tokBoxCallerToken = "aToken";
      var tokBoxCalleeToken = "anotherToken";

      beforeEach(function() {
        sandbox.stub(tokBox, "getSessionTokens", function(cb) {
          cb(null, {
            sessionId: tokBoxSessionId,
            callerToken: tokBoxCallerToken,
            calleeToken: tokBoxCalleeToken
          });
        });
      });

      it("should return callId, sessionId, apiKey and caller token info",
        function(done) {
          sandbox.stub(request, "put");
          supertest(app)
            .post('/returnUserCallTokens')
            .send({
              callerId: callerId,
              callToken: callToken,
              calleeFriendlyName: calleeFriendlyName,
              callType: "audio"
            })
            .expect(200)
            .end(function(err, res) {
              expect(res.body).to.have.property('callId');
              expect(res.body).to.have.property('wsCallerToken');
              expect(res.body).to.have.property('wsCalleeToken');
              expect(res.body).to.have.property('timestamp');
              // Drop callId, we don't know its value.
              delete res.body.callId;
              delete res.body.timestamp;
              delete res.body.wsCallerToken;
              delete res.body.wsCalleeToken;
              expect(res.body).eql({
                callState: "init",
                callToken: callToken,
                callType: "audio",
                calleeFriendlyName: calleeFriendlyName,
                callerId: callerId,
                sessionId: tokBoxSessionId,
                calleeToken: tokBoxCalleeToken,
                callerToken: tokBoxCallerToken
              });
              done();
            });
        });
    });
  });
});
