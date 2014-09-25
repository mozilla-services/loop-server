/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var expect = require("chai").expect;
var addHawk = require("superagent-hawk");
var supertest = addHawk(require("supertest"));
var sinon = require("sinon");
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
var sessionToken = conf.get("fakeCallInfo").token1;
var user = "alexis@notmyidea.org";

describe("/rooms", function() {
  var sandbox, hawkIdHmac, hawkCredentials, userHmac;

  beforeEach(function(done) {
    sandbox = sinon.sandbox.create();

    sandbox.stub(tokBox._opentok.default, "createSession",
      function(options, cb) {
        cb(null, {sessionId: sessionId});
      });

    sandbox.stub(tokBox._opentok.default, "generateToken",
      function() {
        return sessionToken;
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
      res.status(200).json(req.roomBodyData);
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

  describe("POST /rooms for room creation", function() {
    var postRoomReq;

    beforeEach(function() {
      postRoomReq = supertest(app)
        .post('/rooms')
        .type('json')
        .hawk(hawkCredentials);
    });

    it("should have the validateRoomUrlParams middleware.", function() {
      expect(getMiddlewares(apiRouter, 'post', '/rooms'))
        .include(validators.validateRoomUrlParams);
    });

    it("should have the requireHawkSession middleware installed", function() {
      expect(getMiddlewares(apiRouter, 'post', '/rooms'))
        .include(requireHawkSession);
    });

    it("should fail in case roomName parameter is missing", function(done) {
      postRoomReq.send({
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
      postRoomReq.send({
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
      postRoomReq.send({
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

        expect(res.body.expiresAt).to.equal(startTime + 10 * 3600);

        storage.getRoomData(res.body.roomToken, function(err, roomData) {
          if (err) throw err;

          expect(roomData.expiresAt).to.not.eql(undefined);
          delete roomData.expiresAt;
          expect(roomData.creationTime).to.not.eql(undefined);
          delete roomData.creationTime;
          expect(roomData.updateTime).to.not.eql(undefined);
          delete roomData.updateTime;

          expect(roomData).to.eql({
            apiKey: tokBox._opentok.default.apiKey,
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

    it("should not use two times the same token");
  });

  describe("GET /room/:token", function() {
    it("should have the validateRoomToken middleware.", function() {
      expect(getMiddlewares(apiRouter, 'get', '/rooms/:token'))
        .include(validators.validateRoomToken);
    });

    it("should have the requireHawkSession middleware.", function() {
      expect(getMiddlewares(apiRouter, 'get', '/rooms/:token'))
        .include(requireHawkSession);
    });

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
              expect(getRes.body.creationTime).to.be.gte(startTime);
              expect(getRes.body.expiresAt).to.be.gte(startTime + 10 * 3600);

              delete getRes.body.creationTime;
              delete getRes.body.expiresAt;

              expect(getRes.body).to.eql({
                roomOwner: "Alexis",
                roomName: "UX discussion",
                maxSize: 3,
                clientMaxSize: 3,
                participants: []
              });
              done();
            });
        });
    });
  });

  describe("PATCH /room/:token", function() {
    it("should have the validateRoomToken middleware.", function() {
      expect(getMiddlewares(apiRouter, 'patch', '/rooms/:token'))
        .include(validators.validateRoomToken);
    });

    it("should have the validateRoomUrlParams middleware.", function() {
      expect(getMiddlewares(apiRouter, 'patch', '/rooms/:token'))
        .include(validators.validateRoomUrlParams);
    });

    it("should have the requireHawkSession middleware.", function() {
      expect(getMiddlewares(apiRouter, 'patch', '/rooms/:token'))
        .include(requireHawkSession);
    });

    it("should return a 200.", function(done) {
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

          var updateTime = parseInt(Date.now() / 1000, 10);
          supertest(app)
            .patch('/rooms/' + postRes.body.roomToken)
            .hawk(hawkCredentials)
            .send({
              roomOwner: "Natim",
              roomName: "About UX",
              maxSize: "2",
              expiresIn: "5"
            })
            .expect(200)
            .end(function(err, patchRes) {
              if (err) throw err;
              expect(patchRes.body.expiresAt).to.equal(
                updateTime + 5 * 3600
              );

              supertest(app)
                .get('/rooms/' + postRes.body.roomToken)
                .type('json')
                .hawk(hawkCredentials)
                .expect(200)
                .end(function(err, getRes) {
                  if (err) throw err;

                  expect(getRes.body.creationTime).to.be.gte(startTime);
                  delete getRes.body.creationTime;

                  expect(getRes.body.expiresAt).to.be.gte(updateTime + 5 * 3600);
                  delete getRes.body.expiresAt;

                  expect(getRes.body).to.eql({
                    "clientMaxSize": 2,
                    "maxSize": 2,
                    "participants": [],
                    "roomName": "About UX",
                    "roomOwner": "Natim"
                  });
                  done(err);
                });
            });
        });
    });
  });

  describe("POST /room/:token", function() {
    var token, postReq;

    beforeEach(function(done) {
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
          token = postRes.body.roomToken;
          postReq = supertest(app)
            .post('/rooms/' + token)
            .type('json')
            .hawk(hawkCredentials);
          done();
        });
    });

    it("should have the validateRoomToken middleware.", function() {
      expect(getMiddlewares(apiRouter, 'post', '/rooms/:token'))
        .include(validators.validateRoomToken);
    });

    it("should have the requireHawkSession middleware.", function() {
      expect(getMiddlewares(apiRouter, 'post', '/rooms/:token'))
        .include(requireHawkSession);
    });

    it("should fails if action is missing", function(done) {
     postReq
        .send({})
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                              "action should be one of join, refresh, leave");
          done();
        });
    })

    describe("Handle 'join'", function() {
      it("should fail if params are missing.", function(done) {
        postReq
          .send({
            action: "join"
          })
          .expect(400)
          .end(function(err, res) {
            if (err) throw err;
            expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                                "Missing: displayName, clientMaxSize");
            done();
          });
      });

      it("should return appropriate info.", function(done) {
        postReq
          .send({
            action: "join",
            clientMaxSize: 10,
            displayName: "Natim"
          })
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).to.eql({
              "apiKey": tokBox._opentok.default.apiKey,
              "expires": conf.get("rooms").participantTTL,
              "sessionId": sessionId,
              "sessionToken": sessionToken
            });
            done();
          });
      });
    });
  });

  describe("DELETE /room/:token", function() {
    it("should have the validateRoomToken middleware.", function() {
      expect(getMiddlewares(apiRouter, 'delete', '/rooms/:token'))
        .include(validators.validateRoomToken);
    });

    it("should have the requireHawkSession middleware.", function() {
      expect(getMiddlewares(apiRouter, 'delete', '/rooms/:token'))
        .include(requireHawkSession);
    });

    it("should return a 204.", function(done) {
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
            .delete('/rooms/' + postRes.body.roomToken)
            .hawk(hawkCredentials)
            .expect(204)
            .end(function(err) {
              if (err) throw err;
              supertest(app)
                .get('/rooms/' + postRes.body.roomToken)
                .type('json')
                .hawk(hawkCredentials)
                .expect(404)
                .end(function(err) {
                  done(err);
                });
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
