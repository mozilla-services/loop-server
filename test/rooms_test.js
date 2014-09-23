/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var expect = require("chai").expect;
var addHawk = require("superagent-hawk");
var supertest = addHawk(require("supertest"));
var sinon = require("sinon");
var assert = sinon.assert;
var expectFormatedError = require("./support").expectFormatedError;
var errors = require("../loop/errno.json");
var Token = require("express-hawkauth").Token;
var hmac = require("../loop/hmac");
var getMiddlewares = require("./support").getMiddlewares;

var loop = require("../loop");
var app = loop.app;
var auth = loop.auth;
var validators = loop.validators;
var apiRouter = loop.apiRouter;
var conf = loop.conf;
var storage = loop.storage;
var tokBox = loop.tokBox;

var requireHawkSession = auth.requireHawkSession;

var sessionId = conf.get("fakeCallInfo").session1;
var user = "alexis@notmyidea.org";

describe("/rooms", function() {
  var sandbox, hawkIdHmac, hawkCredentials, userHmac;

  beforeEach(function(done) {
    sandbox = sinon.sandbox.create();

    sandbox.stub(tokBox._opentok.default, "createSession",
      function(options, cb) {
        cb(null, {sessionId: sessionId});
      });

    var token = new Token();
    token.getCredentials(function(tokenId, authKey) {
      hawkCredentials = {
        id: tokenId,
        key: authKey,
        algorithm: "sha256"
      };
      hawkIdHmac = hmac(tokenId, conf.get('hawkIdSecret'));
      userHmac = hmac(user, conf.get('userMacSecret'));
      storage.setHawkSession(hawkIdHmac, authKey, function(err) {
        if (err) throw err;
        storage.setHawkUser(userHmac, hawkIdHmac, done);
      });
    });
  });

  afterEach(function(done) {
    sandbox.restore();
    storage.drop(done);
  });

  describe("validators", function() {
    apiRouter.post('/validate-room-url', validators.validateRoomUrlParams, function(req, res) {
      res.status(200).json(req.roomData);
    });

    var validateRoomReq;

    beforeEach(function() {
      validateRoomReq = supertest(app)
        .post('/validate-room-url')
        .type('json');
    });

    it("should not fail if all parameters validate", function(done) {
      validateRoomReq.send({
        roomName: "UX Discussion",
        expiresIn: "5",
        roomOwner: "Alexis",
        maxSize: "2"
      })
      .expect(200)
      .end(done);
    });

    it("should use default value if expiresIn parameter is missing",
      function(done) {
        validateRoomReq.send({
          roomName: "UX Discussion",
          roomOwner: "Alexis",
          maxSize: "2"
        })
        .expect(200)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.body.expiresIn).to.eql(conf.get('rooms').defaultTTL);
          done();
        });
      });

    it("should fail in case roomName parameter is missing", function(done) {
      validateRoomReq.send({
        roomOwner: "Alexis",
        maxSize: "2"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                            "Missing: roomName");
        done();
      });
    });

    it("should fail in case roomOwner parameter is missing", function(done) {
      validateRoomReq.send({
        roomName: "UX Discussion",
        maxSize: "2"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                            "Missing: roomOwner");
        done();
      });
    });

    it("should fail in case maxSize parameter is missing", function(done) {
      validateRoomReq.send({
        roomOwner: "Alexis",
        roomName: "UX Discussion"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                            "Missing: maxSize");
        done();
      });
    });

    it("should fail if roomName exceeds maxRoomNameSize chars", function(done) {
      validateRoomReq.send({
        roomOwner: "Alexis",
        roomName: "This is too long for loop",
        maxSize: "3"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
          "roomName should be shorter than 15 characters");
        done();
      });
    });

    it("should fail if roomOwner exceeds 100 chars", function(done) {
      validateRoomReq.send({
        roomOwner: "Alexis has a name that's too long",
        roomName: "UX discussion",
        maxSize: "3"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
          "roomOwner should be shorter than 10 characters");
        done();
      });
    });

    it("should fail if expiresIn exceeds the server max value",
      function(done) {
        validateRoomReq.send({
          roomOwner: "Alexis",
          roomName: "UX discussion",
          maxSize: "3",
          expiresIn: "11"
        })
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
            "expiresIn cannot be greater than 10");
          done();
        });
      });

    it("should fail if maxSize exceeds the server max value", function(done) {
      validateRoomReq.send({
        roomOwner: "Alexis",
        roomName: "UX discussion",
        maxSize: "4",
        expiresIn: "10"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
          "maxSize cannot be greater than 3");
        done();
      });
    });

  });

  describe("POST /room for room creation", function() {

    it("should return appropriate info", function(done) {
      var startTime = parseInt(Date.now() / 1000, 10);
      supertest(app)
      .post('/rooms')
      .type('json')
      .hawk(hawkCredentials)
      .send({
        roomOwner: "Alexis",
        roomName: "UX discussion",
        maxSize: "3",
        expiresIn: "10"
      })
      .expect(201)
      .end(function(err, res) {
        if (err) throw err;
        expect(res.body.roomToken).to.not.be.undefined;
        expect(res.body.roomUrl).to.eql(
          conf.get('rooms').webAppUrl.replace('{token}', res.body.roomToken));

        expect(res.body.expiresAt).to.be.gte(startTime + 10 * 60);

        storage.getRoomData(res.body.roomToken, function(err, roomData) {
          if (err) throw err;

          expect(roomData.expiresAt).to.not.eql(undefined);
          delete roomData.expiresAt;
          expect(roomData.creationTime).to.not.eql(undefined);
          delete roomData.creationTime;
          expect(roomData).to.eql({
            sessionId: sessionId,
            roomName: "UX discussion",
            maxSize: 3,
            roomOwner: "Alexis",
            expiresIn: 10
          });
          done();
        });
     });
    });

    it("should have the requireHawkSession middleware installed", function() {
      expect(getMiddlewares(apiRouter, 'post', '/rooms'))
        .include(requireHawkSession);
    });

    it("should not use two times the same token");
  });

  describe("GET /room/:token", function() {
    it("should return appropriate info", function(done) {
      var startTime = parseInt(Date.now() / 1000, 10);
      supertest(app)
        .post('/rooms')
        .type('json')
        .hawk(hawkCredentials)
        .send({
          roomOwner: "Alexis",
          roomName: "UX discussion",
          maxSize: "3",
          expiresIn: "10"
        })
        .expect(201)
        .end(function(err, postRes) {
          if (err) throw err;
          supertest(app)
            .get('/rooms/' + postRes.body.roomToken)
            .type('json')
            .hawk(hawkCredentials)
            .expect(200)
            .end(function(err, getRes) {
              if (err) throw err;
              expect(getRes.body).to.eql({
                roomOwner: "Alexis",
                roomName: "UX discussion",
                maxSize: 3,
                clientMaxSize: 3,
                creationTime: startTime,
                expiresAt: startTime + 10 * 3600,
                participants: []
              });
              done();
            });
        });
    });
  });

  describe.skip("GET /rooms/", function() {
    it("should return appropriate info", function(done) {
      var startTime = parseInt(Date.now() / 1000, 10);
      supertest(app)
        .post('/rooms')
        .type('json')
        .hawk(hawkCredentials)
        .send({
          roomOwner: "Alexis",
          roomName: "UX discussion",
          maxSize: "3",
          expiresIn: "10"
        })
        .expect(201)
        .end(function(err, postRes) {
          if (err) throw err;
          supertest(app)
            .get('/rooms/')
            .type('json')
            .hawk(hawkCredentials)
            .expect(200)
            .end(function(err, getRes) {
              if (err) throw err;
              expect(getRes.body).to.eql({
                roomToken: postRes.roomToken,
                roomName: "UX discussion",
                maxSize: "3",
                clientMaxSize: "3",
                currSize: "0",
                ctime: startTime
              });
              done();
            });
        });
    });
  });

});
