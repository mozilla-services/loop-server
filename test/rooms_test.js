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

function generateHawkCredentials(storage, user, callback) {
  var token = new Token();
  token.getCredentials(function(tokenId, authKey) {
    var hawkCredentials = {
      id: tokenId,
      key: authKey,
      algorithm: "sha256"
    };
    var hawkIdHmac = hmac(tokenId, conf.get('hawkIdSecret'));
    var userHmac = hmac(user, conf.get('userMacSecret'));
    storage.setHawkSession(hawkIdHmac, authKey, function(err) {
      if (err) throw err;
      storage.setHawkUser(userHmac, hawkIdHmac, function(err) {
        if (err) throw err;
        callback(hawkCredentials, hawkIdHmac, userHmac);
      });
    });
  });
}

var getRoomInfo = function(hawkCredentials, roomToken, status) {
  return supertest(app)
    .get('/rooms/' + roomToken)
    .type('json')
    .hawk(hawkCredentials)
    .expect(status || 200);
};

var joinRoom = function(hawkCredentials, roomToken, data, status) {
  if (data === undefined) {
    data = {
      displayName: "Alexis",
      clientMaxSize: 2
    };
  }
  data.action = "join";

  return supertest(app)
    .post('/rooms/' + roomToken)
    .hawk(hawkCredentials)
    .send(data)
    .type("json")
    .expect(status || 200);
};

var createRoom = function(hawkCredentials, data, status) {
  if (data === undefined) {
    data = {
      roomOwner: "Alexis",
      roomName: "UX discussion",
      maxSize: "3",
      expiresIn: "10"
    };
  }
  return supertest(app)
    .post('/rooms')
    .type('json')
    .hawk(hawkCredentials)
    .send(data)
    .expect(status || 201);
};

var deleteRoom = function(hawkCredentials, roomToken, status) {
  return supertest(app)
    .delete('/rooms/' + roomToken)
    .hawk(hawkCredentials)
    .expect(status || 204);
};

describe("/rooms", function() {
  var sandbox, hawkIdHmac, hawkCredentials, userHmac,
      hawkIdHmac2, hawkCredentials2, userHmac2;

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

    generateHawkCredentials(storage, user, function(credentials, id, userMac) {
      hawkCredentials = credentials;
      hawkIdHmac = id;
      userHmac = userMac;

      generateHawkCredentials(storage, user,
        function(credentials, id, userMac) {
          hawkCredentials2 = credentials;
          hawkIdHmac2 = id;
          userHmac2 = userMac;
          done();
        });
    });
  });

  afterEach(function(done) {
    sandbox.restore();
    storage.drop(done);
  });

  describe("validators", function() {

    describe("#isRoomParticipant", function() {
      apiRouter.post('/is-room-participant', auth.requireHawkSession,
        validators.validateRoomToken, validators.isRoomParticipant,
        function(req, res) {
          res.status(200).json(req.roomStorageData);
        });

      var request, roomToken, participantCredentials;

      beforeEach(function(done) {
        request = supertest(app)
          .post('/is-room-participant')
          .type('json');

        // Create a room as "Alex" and join as "Natim".
        generateHawkCredentials(storage, "Natim",
          function(credentials, id, userMac) {
            participantCredentials = credentials;
            createRoom(hawkCredentials).end(function(err, res) {
              if (err) throw err;
              roomToken = res.body.roomToken;
              joinRoom(credentials, roomToken)
                .end(done);
            });
          });
      });

      it("should 403 in case user is not a room participant or room owner",
        function(done) {
        generateHawkCredentials(storage, "unknown-user",
          function(credentials, id, userMac) {
            getRoomInfo(credentials, roomToken, 403).end(done);
          });
        });

      it("should 200 ok if the user is a room participant", function(done){
        getRoomInfo(participantCredentials, roomToken, 200).end(done);
      });

      it("should 200 ok if the user is the room owner", function(done) {
        getRoomInfo(hawkCredentials, roomToken, 200).end(done);
      });
    });
    describe("#validateRoomUrlParams", function() {
      apiRouter.post('/validate-room-url', validators.validateRoomUrlParams, function(req, res) {
        res.status(200).json(req.roomRequestData);
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

    describe("#isRoomOwner", function() {
      apiRouter.get('/should-be-room-owner', function(req, res, next) {
        req.roomStorageData = {roomOwnerHmac: userHmac};
        next();
      }, requireHawkSession, validators.isRoomOwner, function(req, res) {
        res.status(200).json("ok");
      });

      var req;
      beforeEach(function() {
        req = supertest(app).get('/should-be-room-owner');
      });

      it("should return a 403 if user is not a room owner", function(done) {
        // Create a valid hawk session, which is not a room owner.
        generateHawkCredentials(storage, "remy", function(hawkCredentials) {
          req
            .hawk(hawkCredentials)
            .expect(403)
            .end(function(err, res) {
              if (err) throw err;
              expectFormatedError(res, 403, errors.UNDEFINED,
                                  "Authenticated user is not the owner of this room.");
              done();
            });
        });
      });

      it("should return a 200 if user is the room owner", function(done) {
        req
          .hawk(hawkCredentials)
          .expect(200)
          .end(done);
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
            expiresIn: 10,
            roomOwnerHmac: userHmac
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

    it("should return 200 with appropriate info", function(done) {
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

    it("should return 200 with the list of participants", function(done) {
      var roomToken;
      var startTime = parseInt(Date.now() / 1000, 10);

      createRoom(hawkCredentials, {
        roomOwner: "Alexis",
        roomName: "UX discussion",
        maxSize: "3",
        expiresIn: "10"
      }).end(function(err, postRes) {
        if (err) throw err;
        roomToken = postRes.body.roomToken;

        joinRoom(hawkCredentials, postRes.body.roomToken).end(function(err, res) {
          if (err) throw err;
          getRoomInfo(hawkCredentials, postRes.body.roomToken).end(
            function(err, getRes) {
              if (err) throw err;
              expect(getRes.body.participants).to.length(1);
              expect(getRes.body.participants[0].id).to.not.eql(undefined);
              expect(getRes.body.participants[0].hawkIdHmac).to.eql(undefined);
              expect(getRes.body.participants[0].id).to.length(36);
              expect(getRes.body.clientMaxSize).to.eql(2);

              joinRoom(hawkCredentials2, postRes.body.roomToken, {
                displayName: "Remy",
                clientMaxSize: 20
              }).end(function(err) {
                if (err) throw err;
                getRoomInfo(hawkCredentials2, roomToken).end(
                  function(err, getRes2) {
                    if (err) throw err;
                    expect(getRes2.body.participants).to.length(2);
                    expect(getRes2.body.participants[0].id).not.eql(undefined);
                    expect(getRes2.body.participants[0].id).to.length(36);
                    expect(getRes2.body.clientMaxSize).to.eql(2);
                    done();
                  });
              });
            });
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

    it("should have the isRoomOwner middleware.", function() {
      expect(getMiddlewares(apiRouter, 'patch', '/rooms/:token'))
        .include(validators.isRoomOwner);
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
    });

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

      it("should return new participant information.", function(done) {
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
            storage.getRoomParticipants(token, function(err, participants) {
              if (err) throw err;
              expect(participants).to.length(1);
              done();
            });
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

    it("should have the isRoomOwner middleware.", function() {
      expect(getMiddlewares(apiRouter, 'delete', '/rooms/:token'))
        .include(validators.isRoomOwner);
    });

    it("should clear the participants list", function(done) {
      createRoom(hawkCredentials).end(function(err, res) {
        if (err) throw err;
        var roomToken = res.body.roomToken;

        joinRoom(hawkCredentials, roomToken).end(function(err) {
          if (err) throw err;
          deleteRoom(hawkCredentials, roomToken).end(function(err) {
            if (err) throw err;
            storage.getRoomParticipants(roomToken, function(err, participants) {
              if (err) throw err;
              expect(participants).to.length(0);
              done();
            });
          });
        })
      });
    });

    it("should delete room if the user is the room owner", function(done) {
      createRoom(hawkCredentials).end(function(err, res) {
        if (err) throw err;
        var roomToken = res.body.roomToken;
        deleteRoom(hawkCredentials, roomToken).end(function(err) {
          if (err) throw err;
          getRoomInfo(hawkCredentials, roomToken, 404).end(done);
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
