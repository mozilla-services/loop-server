/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var supertest = require("supertest");
var sinon = require("sinon");
var assert = sinon.assert;
var randomBytes = require("crypto").randomBytes;

var hmac = require('../loop/hmac');
var loop = require("../loop");
var conf = loop.conf;
var app = loop.app;
var apiRouter = loop.apiRouter;
var apiPrefix = loop.apiPrefix;
var storage = loop.storage;
var requireBasicAuthToken = loop.auth.requireBasicAuthToken;
var authenticateWithHawkOrToken = loop.auth.authenticateWithHawkOrToken;
var Token = require("express-hawkauth").Token;


describe("auth.js", function() {
  var sandbox;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('#requireBasicAuthToken', function() {
    var jsonReq, expectedToken, expectedTokenHmac;

    // Create a route with the auth middleware installed.
    apiRouter.post('/with-requireBasicAuthToken',
      requireBasicAuthToken, function(req, res) {
      res.status(200).json(req.participantTokenHmac);
    });

    beforeEach(function() {
      jsonReq = supertest(app)
        .post(apiPrefix + '/with-requireBasicAuthToken');

      expectedToken = "valid-token";
      expectedTokenHmac = hmac(expectedToken, conf.get('userMacSecret'));

      sandbox.stub(storage, "isValidRoomToken",
        function(roomToken, tokenHmac, cb) {
          if (tokenHmac === expectedTokenHmac) {
            cb(null, true);
          } else {
            cb(null, false);
          }
        });
    });

    it("should require user authentication", function(done) {
      jsonReq
        .expect(401)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.headers['www-authenticate']).to.eql('Basic');
          done();
        });
    });

    it("should reject invalid tokens", function(done) {
      // Mock the calls to the external BrowserID verifier.
      jsonReq
        .auth('invalid-token', '')
        .expect(401)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.headers['www-authenticate'])
            .to.eql('Basic error="Invalid token; it may have expired."');
          done();
        });
    });

    it("should accept valid token", function(done) {
      jsonReq
        .auth(expectedToken, '')
        .expect(200)
        .end(function(err) {
          if (err) throw err;
          done();
        });
    });

    it("should set an 'participantTokenHmac' property on the request object",
      function(done) {
        jsonReq
          .auth(expectedToken, '')
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).eql(expectedTokenHmac);
            done();
          });
      });
  });

  describe("authenticateWithHawkOrToken middleware", function() {
    var expectedToken, expectedTokenHmac;

    apiRouter.post("/authenticateWithHawkOrToken", authenticateWithHawkOrToken,
      function(req, res) {
        res.status(200).json(req.participantTokenHmac || req.hawkIdHmac);
      });

    describe("using a token", function() {
      beforeEach(function() {
        expectedToken = "valid-token";
        expectedTokenHmac = hmac(expectedToken, conf.get('userMacSecret'));

        sandbox.stub(storage, "isValidRoomToken",
          function(roomToken, tokenHmac, cb) {
            if (tokenHmac === expectedTokenHmac) {
              cb(null, true);
            } else {
              cb(null, false);
            }
          });
      });

      it("should accept token", function(done) {
        supertest(app)
          .post(apiPrefix + "/authenticateWithHawkOrToken")
          .auth(expectedToken, '')
          .expect(200)
          .end(function(err, res) {
            if (err) {
              throw err;
            }
            expect(res.body).to.eql(expectedTokenHmac);
            done();
          });
      });

      it("shouldn't accept invalid token", function(done) {
          supertest(app)
            .post(apiPrefix + "/authenticateWithHawkOrToken")
            .auth('wrongToken', '')
            .expect(401)
            .end(done);
        });
    });

    describe("using an Hawk session", function() {
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
            .post(apiPrefix + "/authenticateWithHawkOrToken")
            .hawk(hawkCredentials)
            .expect(200)
            .end(done);
        });

      it("shouldn't accept invalid hawk credentials", function(done) {
          hawkCredentials.id = randomBytes(16).toString("hex");
          supertest(app)
            .post(apiPrefix + "/authenticateWithHawkOrToken")
            .hawk(hawkCredentials)
            .expect(401)
            .end(done);
        });

      it("should update session expiration time on auth", function(done) {
        sandbox.spy(storage, "touchHawkSession");
        supertest(app)
          .post(apiPrefix + "/authenticateWithHawkOrToken")
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

    it("should accept no Token nor Hawk",
      function(done) {
        supertest(app)
          .post(apiPrefix + "/authenticateWithHawkOrToken")
          .expect(200)
          .end(function(err, res) {
            if (err) {
              throw err;
            }
            expect(res.body).to.eql({});
            done();
          });
      });
  });
});
