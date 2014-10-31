/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var supertest = require("supertest");
var sinon = require("sinon");

var hmac = require('../loop/hmac');
var loop = require("../loop");
var conf = loop.conf;
var app = loop.app;
var apiRouter = loop.apiRouter;
var apiPrefix = loop.apiPrefix;
var storage = loop.storage;
var requireRoomSessionToken = loop.auth.requireRoomSessionToken;


describe("auth.js", function() {
  var sandbox;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('#requireRoomSessionToken', function() {
    var jsonReq, expectedToken, expectedTokenHmac;

    // Create a route with the auth middleware installed.
    apiRouter.post('/with-requireRoomSessionToken',
      requireRoomSessionToken, function(req, res) {
      res.status(200).json(req.participantTokenHmac);
    });

    beforeEach(function() {
      jsonReq = supertest(app)
        .post(apiPrefix + '/with-requireRoomSessionToken');

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
          expect(res.headers['www-authenticate']).to.eql('Token');
          done();
        });
    });

    it("should reject invalid tokens", function(done) {
      // Mock the calls to the external BrowserID verifier.
      jsonReq
        .set('Authorization', 'Token ' + "invalid-token")
        .expect(401)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.headers['www-authenticate'])
            .to.eql('Token error="Invalid token; it as probably expired."');
          done();
        });
    });

    it("should accept valid token", function(done) {
      jsonReq
        .set('Authorization', 'Token ' + expectedToken)
        .expect(200)
        .end(function(err) {
          if (err) throw err;
          done();
        });
    });

    it("should set an 'participantTokenHmac' property on the request object",
      function(done) {
        jsonReq
          .set('Authorization', 'Token ' + expectedToken)
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).eql(expectedTokenHmac);
            done();
          });
      });
  });
});
