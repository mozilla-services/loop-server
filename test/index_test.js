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
var tokenlib = require("../loop/tokenlib");
var fxaAuth = require("../loop/fxa");
var Token = require("../loop/token").Token;

var app = require("../loop").app;
var conf = require("../loop").conf;
var hmac = require("../loop").hmac;
var storage = require("../loop").storage;
var validateToken = require("../loop").validateToken;
var requireParams = require("../loop").requireParams;
var authenticate = require("../loop").authenticate;

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

    it("should return a 400 if the token is invalid.", function(done) {
      jsonReq
        .get('/validateToken/invalidToken/')
        .expect(400, /invalid token/)
        .end(done);
    });

    it("should return a 400 if the token had been revoked", function(done) {
      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });
      var tokenWrapper = tokenManager.encode({
        uuid: "1234",
        user: "natim"
      });
      storage.revokeURLToken(tokenWrapper.payload, function(err) {
        if (err) {
          throw err;
        }
        jsonReq
          .get('/validateToken/' + tokenWrapper.token)
          .expect(400, /invalid token/)
          .end(done);
      });
    });

    it("should return a 200 if the token is valid.", function(done) {
      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });

      var token = tokenManager.encode({
        uuid: "1234",
        user: "natim",
        callerId: "alexis"
      }).token;

      jsonReq
        .get('/validateToken/' + token)
        .expect(200, /ok/)
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
              expect(res.header['www-authenticate']).to.eql('Hawk');
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
});
