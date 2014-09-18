/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* jshint expr: true */
"use strict";

var querystring = require("querystring");
var expect = require("chai").expect;
var randomBytes = require("crypto").randomBytes;
var addHawk = require("superagent-hawk");
var supertest = addHawk(require("supertest"));
var sinon = require("sinon");
var assert = sinon.assert;
var fxaAuth = require("../loop/fxa");
var Token = require("express-hawkauth").Token;
var constants = require("../loop/constants");
var hmac = require("../loop/hmac");
var loop = require("../loop");
var apiPrefix = loop.apiPrefix;
var conf = loop.conf;
var app = loop.app;
var apiRouter = loop.apiRouter;
var server = loop.server;
var shutdown = loop.shutdown;
var storage = loop.storage;
var storeUserCallTokens = loop.storeUserCallTokens;
var tokBox = loop.tokBox;
var request = require("request");
var auth = loop.auth;
var authenticate = auth.authenticate;
var validators = loop.validators;
var validateToken = validators.validateToken;
var requireParams = validators.requireParams;
var validateSimplePushURL = validators.validateSimplePushURL;
var validateCallType = validators.validateCallType;
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
    apiRouter.get('/validateToken/:token', validateToken, function(req, res) {
      res.status(200).json();
    });

    afterEach(function(done) {
      storage.drop(done);
    });

    it("should return a 404 if the token is missing.", function(done) {
      jsonReq
        .get(apiPrefix + '/validateToken/')
        .expect(404)
        .end(done);
    });

    it("should return a 404 if the token is invalid.", function(done) {
      jsonReq
        .get(apiPrefix + '/validateToken/invalidToken')
        .expect(404)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res, 404, errors.INVALID_TOKEN,
                              "Token not found.");
          done();
        });
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
            .get(apiPrefix + '/validateToken/1234')
            .expect(404)
            .end(function(err, res) {
              if (err) throw err;
              expectFormatedError(res, 404, errors.INVALID_TOKEN,
                                  "Token not found.");
              done();
            });
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
          .get(apiPrefix + '/validateToken/1234')
          .expect(200)
          .end(done);
      });
    });
  });

  describe("#validateSimplePushURL", function() {
    // Create a route with the validateSimplePushURL middleware installed.
    apiRouter.post('/validateSP/', validateSimplePushURL, function(req, res) {
      res.status(200).json();
    });

    it("should validate the simple push url", function(done) {
      jsonReq
        .post(apiPrefix + '/validateSP/')
        .send({'simplePushURL': 'not-an-url'})
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
                              "simplePushURLs.calls should be a valid url");
          done();
        });
    });

    it("should work with a valid simple push url", function(done) {
      jsonReq
        .post(apiPrefix + '/validateSP/')
        .send({'simplePushURL': 'http://this-is-an-url'})
        .expect(200)
        .end(done);
    });

    it("should work with a valid simple push url in the querystring",
      function(done) {
        jsonReq
          .post(apiPrefix + '/validateSP/?' + querystring.stringify({
            simplePushURL: 'http://this-is-an-url'
          }))
          .send({})
          .expect(200)
          .end(done);
      });

    it("should accept simple_push_url when requesting simplePushURL.",
      function(done) {
        jsonReq
          .post(apiPrefix + '/validateSP')
          .send({simple_push_url: "http://deny"})
          .expect(200)
          .end(done);
      });

    it("should works with simplePushURLs.", function(done) {
        jsonReq
          .post(apiPrefix + '/validateSP')
          .send({simplePushURLs: {
            "calls": "http://deny",
            "rooms": "http://rooms"
          }})
          .expect(200)
          .end(done);
      });
  });

  describe("#validateCallType", function() {
    // Create a route with the validateSimplePushURL middleware installed.
    apiRouter.post('/validateCallType/', validateCallType, function(req, res) {
      res.status(200).json();
    });

    it("should error on empty callType", function(done) {
      jsonReq
        .post(apiPrefix + '/validateCallType/')
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
        .post(apiPrefix + '/validateCallType/')
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
        .post(apiPrefix + '/validateCallType/')
        .send({callType: 'audio'})
        .expect(200)
        .end(done);
    });

    it("should accept a valid'audio-video' callType", function(done) {
      jsonReq
        .post(apiPrefix + '/validateCallType/')
        .send({callType: 'audio-video'})
        .expect(200)
        .end(done);
    });

  });

  describe("#requireParams", function(){
    // Create a route with the requireParams middleware installed.
    apiRouter.post('/requireParams/', requireParams('a', 'b'),
      function(req, res) {
        res.status(200).json();
      });

    apiRouter.post('/requireParams/simplePushURL',
      requireParams('simplePushURL'), function(req, res) {
        res.status(200).json();
      });

    it("should return a 406 if the body is not in JSON.", function(done) {
      jsonReq
        .post(apiPrefix + '/requireParams/')
        .set('Accept', 'text/html')
        .expect(406, /json/)
        .end(done);
    });

    it("should return a 400 if one of the required params are missing.",
      function(done) {
        jsonReq
          .post(apiPrefix + '/requireParams/')
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
        .post(apiPrefix + '/requireParams/')
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
        .post(apiPrefix + '/requireParams/')
        .send({a: "Ok", b: "Ok"})
        .expect(200)
        .end(done);
    });
  });

  describe("authentication middleware", function() {
    var expectedAssertion, sandbox, user;
    user = "alexis";

    apiRouter.post("/with-authenticate", authenticate, function(req, res) {
      res.status(200).json();
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
            .post(apiPrefix + "/with-authenticate")
            .set('Authorization', 'BrowserID ' + expectedAssertion)
            .expect(200)
            .end(function(err, res) {
              if (err) {
                throw err;
              }
              expect(res.header['hawk-session-token']).to.not.be.undefined;
              done();
            });
        });

      it("shouldn't accept invalid assertions", function(done) {
          supertest(app)
            .post(apiPrefix + "/with-authenticate")
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
            .post(apiPrefix + "/with-authenticate")
            .hawk(hawkCredentials)
            .expect(200)
            .end(done);
        });

      it("shouldn't accept invalid hawk credentials", function(done) {
          hawkCredentials.id = randomBytes(16).toString("hex");
          supertest(app)
            .post(apiPrefix + "/with-authenticate")
            .hawk(hawkCredentials)
            .expect(401)
            .end(done);
        });
      it("should update session expiration time on auth", function(done) {
        sandbox.spy(storage, "touchHawkSession");
        supertest(app)
          .post(apiPrefix + "/with-authenticate")
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
          .post(apiPrefix + "/with-authenticate")
          .expect(200)
          .end(function(err, res) {
            if (err) {
              throw err;
            }
            expect(res.header['hawk-session-token']).to.not.be.undefined;
            expect(res.header['hawk-session-token']).to.length(64);
            done();
          });
      });
  });

  describe("#storeUserCallTokens", function() {
    var sandbox;

    apiRouter.post('/storeUserCallTokens', function(req, res) {
      storeUserCallTokens({
        callerId: req.body.callerId,
        calleeFriendlyName: req.body.calleeFriendlyName,
        callToken: req.body.callToken,
        callType: req.body.callType
      }, function(err, callTokens) {
        if(res.serverError(err)) return;

        res.status(200).json(callTokens);
      });
    });

    beforeEach(function() {
      sandbox = sinon.sandbox.create();
    });

    afterEach(function() {
      sandbox.restore();
    });

    it("should return a 503 if tokbox API errors out", function(done) {
      sandbox.stub(tokBox, "getSessionTokens", function(opts, cb) {
        cb("error");
      });

      supertest(app)
        .post(apiPrefix + '/storeUserCallTokens')
        .send({callType: "audio"})
        .expect(503)
        .end(done);
    });

    describe("With working tokbox APIs", function() {

      var callerId = "aCallerId";
      var calleeFriendlyName = "issuerName";
      var callToken = 'call-token';
      var tokBoxApiKey = '123456';
      var tokBoxSessionId = "aTokboxSession";
      var tokBoxCallerToken = "aToken";
      var tokBoxCalleeToken = "anotherToken";

      beforeEach(function() {
        sandbox.stub(tokBox, "getSessionTokens", function(opts, cb) {
          cb(null, {
            apiKey: tokBoxApiKey,
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
            .post(apiPrefix + '/storeUserCallTokens')
            .send({
              callerId: callerId,
              callToken: callToken,
              calleeFriendlyName: calleeFriendlyName,
              callType: "audio"
            })
            .expect(200)
            .end(function(err, res) {
              if (err) {
                throw err;
              }
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
                apiKey: "123456",
                callState: constants.CALL_STATES.INIT,
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

  describe("404 error page and 307 redirection", function() {
    it("should return a 307 if apiPrefix is missing.", function(done) {
      supertest(app)
        .get('/toto')
        .send()
        .expect(307)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.headers.location).to.equal(apiPrefix + "/toto");
          done();
        });
    });

    it("should return a 404 if apiPrefix and page not found.", function(done) {
      supertest(app)
        .get(apiPrefix + '/toto')
        .send()
        .expect(404)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res, 404, 999,
                              "Resource not found.");
          done();
        });
    });
  });
});
