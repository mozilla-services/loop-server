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

var app = require("../loop").app;
var conf = require("../loop").conf;
var hmac = require("../loop").hmac;
var storage = require("../loop").storage;
var validateToken = require("../loop").validateToken;
var requireParams = require("../loop").requireParams;
var authenticate = require("../loop").authenticate;
var validateSimplePushURL = require("../loop").validateSimplePushURL;
var returnUserCallTokens = require("../loop").returnUserCallTokens;
var tokBox = require("../loop").tokBox;
var request = require("../loop").request;

var expectFormatedError = require("./support").expectFormatedError;

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
      storage.addUserCallUrlData("natim", {
        urlId: "1234",
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
      storage.addUserCallUrlData("natim", {
        urlId: "1234",
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
        .send({'simple_push_url': 'not-an-url'})
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res.body, "body", "simple_push_url",
                              "simple_push_url should be a valid url");
          done();
        });
    });

    it("should work with a valid simple push url", function(done) {
      jsonReq
        .post('/validateSP/')
        .send({'simple_push_url': 'http://this-is-an-url'})
        .expect(200)
        .end(done);
    });

  });

  describe("#requireParams", function(){
    // Create a route with the requireParams middleware installed.
    app.post('/requireParams/', requireParams('a', 'b'), function(req, res) {
      res.json(200, "ok");
    });

    it("should return a 406 if the body is not in JSON.", function(done) {
      jsonReq
        .post('/requireParams/')
        .set('Accept', 'text/html')
        .expect(406, /json/)
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
            expect(res.body).eql({
              status: "errors",
              errors: [{location: "body",
                        name: "b",
                        description: "missing: b"}]
            });
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
          expect(res.body).eql({
            status: "errors",
            errors: [{location: "body",
                      name: "a",
                      description: "missing: a"},
                     {location: "body",
                      name: "b",
                      description: "missing: b"}]
          });
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
      var hawkCredentials;

      beforeEach(function(done) {
        // Generate Hawk credentials.
        var token = new Token();
        token.getCredentials(function(tokenId, authKey) {
          hawkCredentials = {
            id: tokenId,
            key: authKey,
            algorithm: "sha256"
          };
          storage.setHawkSession(tokenId, authKey, done);
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
            assert.calledWithExactly(storage.touchHawkSession,
                                     hawkCredentials.id);
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
      returnUserCallTokens(
        req.body.callee,
        req.body.callerId,
        req.body.urls,
        res
      );
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
        .send({})
        .expect(503)
        .end(done);
    });

    describe("With working tokbox APIs", function() {

      var user = "user@arandomuri";
      var callerId = "aCallerId";
      var urls = ["url1", "url2"];

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

      it("should trigger all the simple push URLs of the user", function(done) {
        var stub = sandbox.stub(request, "put");
        supertest(app)
          .post('/returnUserCallTokens')
          .send({
            callee: user,
            callerId: callerId,
            urls: urls
          })
          .expect(200)
          .end(function(err, res) {
            assert.calledTwice(request.put);
            expect(stub.args[0][0].url).eql(urls[0]);
            expect(stub.args[1][0].url).eql(urls[1]);
            done();
          });
      });

      it("should return callId, sessionId, apiKey and caller token info",
        function(done) {
          sandbox.stub(request, "put");
          supertest(app)
            .post('/returnUserCallTokens')
            .send({
              callee: user,
              callerId: callerId,
              urls: urls
            })
            .expect(200)
            .end(function(err, res) {
              expect(res.body).to.have.property('callId');
              // Drop callId, we don't know its value.
              delete res.body.callId;
              expect(res.body).eql({
                sessionId: tokBoxSessionId,
                sessionToken: tokBoxCallerToken,
                apiKey: tokBox.apiKey
              });
              done();
            });
        });

      it("should store sessionId and callee token info in database",
        function(done) {
          sandbox.stub(request, "put");
          // Don't want to see the already created calls.
          storage.drop();

          supertest(app)
            .post('/returnUserCallTokens')
            .send({
              callee: user,
              callerId: callerId,
              urls: urls
            })
            .expect(200)
            .end(function(err, res) {
              storage.getUserCalls(user, function(err, items) {
                if (err) throw err;
                expect(items.length).eql(1);
                expect(items[0].callId).to.have.length(32);
                delete items[0].callId;
                expect(items[0]).to.have.property('timestamp');
                delete items[0].timestamp;
                expect(items[0]).eql({
                  callerId: callerId,
                  userMac: user,
                  sessionId: tokBoxSessionId,
                  calleeToken: tokBoxCalleeToken,
                });
                done();
              });
            });
        });

      it("should return a 503 if callsStore is not available", function(done) {
        sandbox.stub(storage, "addUserCall", function(unused, alsounused, cb) {
          cb("error");
        });

        sandbox.stub(request, "put");
        supertest(app)
          .post('/returnUserCallTokens')
          .send({
            callee: user,
            callerId: callerId,
            urls: urls
          })
          .expect(503)
          .end(done);
      });
    });
  });

});
