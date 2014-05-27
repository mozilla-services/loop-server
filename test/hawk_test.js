/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* jshint expr: true */
"use strict";

var expect = require("chai").expect;
var addHawk = require("superagent-hawk");
var supertest = addHawk(require("supertest"));
var crypto = require("crypto");

var app = require("../loop").app;
var hawk = require("../loop/hawk");
var Token = require("../loop/token").Token;

describe("hawk middleware", function() {

  var _getExistingSession = function(tokenId, cb) {
    cb(null, {
      key: crypto.randomBytes(16).toString("hex"),
      algorithm: "sha256"
    });
  };

  var _getNonExistingSession = function(tokenId, cb) {
    cb(null, null);
  };

  var createSessionArguments, credentials;

  var _createSession = function(id, key, cb) {
    createSessionArguments = arguments;
    cb();
  };

  var ok_200 = function(req, res) {
    res.json(200);
  };

  app.post('/require-session', hawk.getMiddleware(_getExistingSession), ok_200);
  app.post('/require-or-create-session',
    hawk.getMiddleware(_getExistingSession, _createSession), ok_200);

  app.post('/require-invalid-session', 
    hawk.getMiddleware(_getNonExistingSession), ok_200);

  app.post('/require-or-create-invalid-session', 
    hawk.getMiddleware(_getNonExistingSession, _createSession), ok_200);

  beforeEach(function(done) {
    createSessionArguments = undefined;
    var token = new Token();
    token.getCredentials(function(tokenId, authKey) {
      credentials = {
        id: tokenId,
        key: authKey,
        algorithm: "sha256"
      };
      done();
    });
  });

  describe("requireSession", function() {
    it("should challenge the client if no auth is provided", function(done) {
      supertest(app).post('/require-session').expect(401).end(done);
    });

    it("should accept a valid hawk session", function(done) {
      supertest(app)
        .post('/require-session')
        .hawk(credentials)
        .expect(200)
        .end(done);
    });

    it("should reject an invalid hawk session", function(done) {
      supertest(app)
        .post('/require-invalid-session')
        .hawk(credentials)
        .expect(403)
        .end(done);
    });
  });

  describe("requireOrCreateSession", function() {
    it("should create a session if none is provided", function(done) {
      supertest(app)
        .post('/require-or-create-session')
        .expect(200)
        .end(function(err, res) {
          expect(createSessionArguments).to.not.be.undefined;
          expect(res.header['hawk-session-token']).to.not.be.undefined;
          done();
        });
    });

    it("should accept a valid hawk session", function(done) {
      supertest(app)
        .post('/require-or-create-session')
        .hawk(credentials)
        .expect(200)
        .end(done);
    });

    it("should reject an invalid hawk session", function(done) {
      supertest(app)
        .post('/require-or-create-invalid-session')
        .hawk(credentials)
        .expect(403)
        .end(done);
    });
  });
});
