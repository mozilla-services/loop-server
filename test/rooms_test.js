/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var expect = require("chai").expect;
var addHawk = require("superagent-hawk");
var supertest = addHawk(require("supertest"));
var sinon = require("sinon");
var expectFormattedError = require("./support").expectFormattedError;
var errors = require("../loop/errno.json");
var Token = require("express-hawkauth").Token;
var hmac = require("../loop/hmac");
var getMiddlewares = require("./support").getMiddlewares;
var encrypt = require('../loop/encrypt').encrypt;


var loop = require("../loop");
var request = require("request");
var app = loop.app;
var auth = loop.auth;
var validators = loop.validators;
var apiRouter = loop.apiRouter;
var conf = loop.conf;
var storage = loop.storage;
var tokBox = loop.tokBox;

var requireHawkSession = auth.requireHawkSession;
var authenticateWithHawkOrToken = auth.authenticateWithHawkOrToken;

var sessionId = conf.get("fakeCallInfo").session1;
var sessionToken = conf.get("fakeCallInfo").token1;
var user = "alexis@notmyidea.org";
var spurl = "http://notmyidea.org";

/**
 * Generates hawk credentials for the given user and return them.
 *
 * These credentials are valid and match to a firefox account in the database.
 **/
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
        var encryptedIdentifier = encrypt(tokenId, user);
        storage.setHawkUser(userHmac, hawkIdHmac, function(err) {
          if (err) throw err;
          storage.setHawkUserId(hawkIdHmac, encryptedIdentifier,
            function(err) {
              if (err) throw err;
              callback(hawkCredentials, hawkIdHmac, userHmac);
            });
        });
      });
    });
  });
}

function register(credentials, url, status) {
  var hawkCredentials = credentials.hawkCredentials || credentials;
  if (status === undefined) {
    status = 200;
  }

  return supertest(app)
    .post('/registration')
    .hawk(hawkCredentials)
    .type('json')
    .send({
      "simplePushURLs": {
        "calls": url + "/calls",
        "rooms": url
      }
    })
    .expect(status);
}


var getRoomInfo = function(credentials, roomToken, status) {
  var hawkCredentials = credentials.hawkCredentials || credentials;
  return supertest(app)
    .get('/rooms/' + roomToken)
    .type('json')
    .hawk(hawkCredentials)
    .expect(status || 200);
};

var joinRoom = function(credentials, roomToken, data, status) {
  if (data === undefined) {
    data = {
      displayName: "Alexis",
      clientMaxSize: 2
    };
  }
  data.action = "join";

  var hawkCredentials;

  if (credentials) {
      hawkCredentials = credentials.hawkCredentials || credentials;
  }

  var req = supertest(app)
    .post('/rooms/' + roomToken)
    .send(data)
    .type("json")
    .expect(status || 200);

  if (hawkCredentials && hawkCredentials.hasOwnProperty("id")) {
    req = req.hawk(hawkCredentials);
  }

  return req;
};

var refreshRoom = function(credentials, roomToken, status) {
  var req = supertest(app)
    .post('/rooms/' + roomToken)
    .send({action: "refresh"})
    .type("json")
    .expect(status || 200);

  if (credentials.token !== undefined) {
    req = req.auth(credentials.token, "");
  } else {
    req = req.hawk(credentials.hawkCredentials || credentials);
  }

  return req;
};

var leaveRoom = function(credentials, roomToken, status) {
  var req = supertest(app)
    .post('/rooms/' + roomToken)
    .send({action: "leave"})
    .type("json")
    .expect(status || 204);

  if (credentials.token !== undefined) {
    req = req.auth(credentials.token, "");
  } else {
    req = req.hawk(credentials.hawkCredentials || credentials);
  }

  return req;
};

var createRoom = function(credentials, data, status) {
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
    .hawk(credentials || credentials.hawkCredentials)
    .send(data)
    .expect(status || 201);
};

var getUserRoomsInfo = function(credentials, version, status) {
  var url = '/rooms';
  if (version !== undefined) {
    url += '?version=' + version;
  }

  return supertest(app)
    .get(url)
    .type('json')
    .hawk(credentials || credentials.hawkCredentials)
    .expect(status || 200);
};

var deleteRoom = function(hawkCredentials, roomToken, status) {
  return supertest(app)
    .delete('/rooms/' + roomToken)
    .hawk(hawkCredentials)
    .expect(status || 204);
};

describe("/rooms", function() {
  var sandbox, hawkCredentials, userHmac, hawkCredentials2, requests;

  beforeEach(function(done) {
    requests = [];
    sandbox = sinon.sandbox.create();

    sandbox.stub(request, "put", function(options) {
      requests.push(options);
    });

    sandbox.stub(tokBox._opentok.default, "createSession",
      function(options, cb) {
        cb(null, {sessionId: sessionId});
      });

    sessionToken = conf.get("fakeCallInfo").token1;
     sandbox.stub(tokBox._opentok.default, "generateToken",
       function() {
         return sessionToken;
       });

    generateHawkCredentials(storage, user, function(credentials, id, userMac) {
      hawkCredentials = credentials;
      userHmac = userMac;

      register(hawkCredentials, spurl).end(function(err, res) {
        if (err) throw err;

        generateHawkCredentials(storage, user,
          function(credentials) {
            hawkCredentials2 = credentials;
            done();
          });
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

      var roomToken, participantCredentials;

      beforeEach(function(done) {

        // Create a room as "Alex" and join as "Natim".
        generateHawkCredentials(storage, "Natim",
          function(credentials) {
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
          function(credentials) {
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
          expectFormattedError(res, 400, errors.INVALID_PARAMETERS,
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
          expectFormattedError(res, 400, errors.INVALID_PARAMETERS,
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
            expectFormattedError(res, 400, errors.INVALID_PARAMETERS,
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
          expectFormattedError(res, 400, errors.INVALID_PARAMETERS,
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
              expectFormattedError(res, 403, errors.UNDEFINED,
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
        expectFormattedError(res, 400, errors.MISSING_PARAMETERS,
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
        expectFormattedError(res, 400, errors.MISSING_PARAMETERS,
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
        expectFormattedError(res, 400, errors.MISSING_PARAMETERS,
                            "Missing: maxSize");
        done();
      });
    });

    it("should create the room.", function(done) {
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
            roomToken: res.body.roomToken,
            maxSize: 3,
            roomOwner: "Alexis",
            expiresIn: 10,
            roomOwnerHmac: userHmac
          });

          expect(requests).to.length(1);
          done();
        });
     });
    });

    it("should not use two times the same token");
  });

  describe("GET /rooms/:token", function() {
    it("should have the validateRoomToken middleware.", function() {
      expect(getMiddlewares(apiRouter, 'get', '/rooms/:token'))
        .include(validators.validateRoomToken);
    });

    it("should have the requireHawkSession middleware.", function() {
      expect(getMiddlewares(apiRouter, 'get', '/rooms/:token'))
        .include(requireHawkSession);
    });

    it("should return 200 with room info", function(done) {
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
          var roomToken = postRes.body.roomToken;
          supertest(app)
            .get('/rooms/' + roomToken)
            .type('json')
            .hawk(hawkCredentials)
            .expect(200)
            .end(function(err, getRes) {
              if (err) throw err;
              expect(getRes.body.creationTime).to.be.gte(startTime);
              expect(getRes.body.ctime).to.be.gte(startTime);
              expect(getRes.body.expiresAt).to.be.gte(startTime + 10 * 3600);

              delete getRes.body.creationTime;
              delete getRes.body.ctime;
              delete getRes.body.expiresAt;

              var roomUrl = conf.get('rooms').webAppUrl
                .replace('{token}', roomToken);

              expect(getRes.body).to.eql({
                roomUrl: roomUrl,
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
      createRoom(hawkCredentials, {
        roomOwner: "Alexis",
        roomName: "UX discussion",
        maxSize: "3",
        expiresIn: "10"
      }).end(function(err, postRes) {
        if (err) throw err;
        roomToken = postRes.body.roomToken;

        joinRoom(hawkCredentials, postRes.body.roomToken).end(function(err) {
          if (err) throw err;
          getRoomInfo(hawkCredentials, postRes.body.roomToken).end(
            function(err, getRes) {
              if (err) throw err;
              expect(getRes.body.participants).to.length(1);
              expect(getRes.body.participants[0].id).to.not.eql(undefined);
              expect(getRes.body.participants[0].hawkIdHmac).to.eql(undefined);
              expect(getRes.body.participants[0].id).to.length(36);
              expect(getRes.body.clientMaxSize).to.eql(2);

              expect(getRes.body.participants[0].account)
                .to.eql("alexis@notmyidea.org");

              // Let's join with a second device.
              generateHawkCredentials(storage, "remy@mozilla.com",
                function(remyCredentials) {

                  joinRoom(remyCredentials, postRes.body.roomToken, {
                    displayName: "Remy",
                    clientMaxSize: 20
                  }).end(function(err) {
                    if (err) throw err;
                    getRoomInfo(remyCredentials, roomToken).end(
                      function(err, getRes2) {
                        if (err) throw err;

                        var accounts = getRes2.body.participants.map(function(p) {
                          return p.account;
                        }).sort();

                        expect(accounts).to.length(2);
                        expect(accounts).to.eql(["alexis@notmyidea.org",
                                                 "remy@mozilla.com"]);
                        done();
                      });
                  });
                });
            });
        });
      });
    });
  });

  describe("PATCH /rooms/:token", function() {
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

    it("should update the roomData.", function(done) {
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
          requests = [];
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
              expect(patchRes.body.expiresAt).to.gte(
                updateTime + 5 * 3600
              );

              var roomToken = postRes.body.roomToken;

              supertest(app)
                .get('/rooms/' + roomToken)
                .type('json')
                .hawk(hawkCredentials)
                .expect(200)
                .end(function(err, getRes) {
                  if (err) throw err;

                  expect(getRes.body.creationTime).to.be.gte(startTime);
                  delete getRes.body.creationTime;

                  expect(getRes.body.ctime).to.be.gte(updateTime);
                  delete getRes.body.ctime;

                  expect(getRes.body.expiresAt).to.be.gte(updateTime + 5 * 3600);
                  delete getRes.body.expiresAt;

                  var roomUrl = conf.get('rooms').webAppUrl
                    .replace('{token}', roomToken);

                  expect(getRes.body).to.eql({
                    "roomUrl": roomUrl,
                    "clientMaxSize": 2,
                    "maxSize": 2,
                    "participants": [],
                    "roomName": "About UX",
                    "roomOwner": "Natim"
                  });

                  expect(requests).to.length(1);
                  done();
                });
            });
        });
    });
  });

  describe("POST /rooms/:token", function() {
    var token, postReq;

    it("should have the validateRoomToken middleware.", function() {
      expect(getMiddlewares(apiRouter, 'post', '/rooms/:token'))
        .include(validators.validateRoomToken);
    });

    it("should have the authenticateWithHawkOrToken middleware.", function() {
      expect(getMiddlewares(apiRouter, 'post', '/rooms/:token'))
        .include(authenticateWithHawkOrToken);
    });


    describe("Using Hawk", function() {
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

      it("should fails if action is missing", function(done) {
       postReq
          .send({})
          .expect(400)
          .end(function(err, res) {
            if (err) throw err;
            expectFormattedError(res, 400, errors.MISSING_PARAMETERS,
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
              expectFormattedError(res, 400, errors.MISSING_PARAMETERS,
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

        it("should reject new participant if new participant clientMaxSize is " +
           "lower or equal to the current number of participants.", function(done) {
             createRoom(hawkCredentials).end(function(err, res) {
               if (err) throw err;
               var roomToken = res.body.roomToken;
               joinRoom(hawkCredentials, roomToken).end(function(err) {
                 if (err) throw err;
                 generateHawkCredentials(storage, 'Natim', function(natimCredentials) {
                   joinRoom(natimCredentials, roomToken, {
                       displayName: "Natim",
                       clientMaxSize: 1
                   }, 400).end(function(err, res) {
                     if (err) throw err;
                     expectFormattedError(
                       res, 400, errors.CLIENT_REACHED_CAPACITY,
                       "Too many participants in the room for you to handle."
                     );
                     done();
                   });
                 });
               });
             });
           });

        it("should reject new participant if the room clientMaxSize is already reached.",
          function(done) {
            createRoom(hawkCredentials).end(function(err, res) {
               if (err) throw err;
               var roomToken = res.body.roomToken;
               // Alexis joins
               joinRoom(hawkCredentials, roomToken).end(function(err) {
                 if (err) throw err;
                 generateHawkCredentials(storage, 'Natim', function(natimCredentials) {
                   // Natim joins
                   joinRoom(natimCredentials, roomToken, {
                       displayName: "Natim",
                       clientMaxSize: 2
                   }, 200).end(function(err) {
                     if (err) throw err;
                     generateHawkCredentials(storage, 'Julie', function(julieCredentials) {
                       // Julie tries to joins
                       joinRoom(julieCredentials, roomToken, {
                         displayName: "Julie",
                         clientMaxSize: 3
                       }, 400).end(function(err, res) {
                         if (err) throw err;
                         expectFormattedError(
                           res, 400, errors.ROOM_FULL,
                           "The room is full."
                         );
                         done();
                       });
                     });
                   });
                 });
               });
             });
          });

        it("should notify all the room owner devices.", function(done) {
            register(hawkCredentials2, spurl + "2").end(function(err) {
              if (err) throw err;
              createRoom(hawkCredentials).end(function(err, res) {
                if (err) throw err;
                var roomToken = res.body.roomToken;
                generateHawkCredentials(storage, 'Julie', function(julieCredentials) {
                  var joinTime = parseInt(Date.now() / 1000, 10);
                  requests = [];
                  joinRoom(julieCredentials, roomToken).end(function(err) {
                    if (err) throw err;
                    expect(requests).to.length(2);
                    expect(requests[0].url).to.match(/http:\/\/notmyidea/);
                    expect(requests[0].form.version).to.gte(joinTime);
                    done()
                  });
                });
              });
            });
        });
      });

      describe("Handle 'refresh'", function() {
        var clock;

        // Should touch the participant expiracy
        beforeEach(function() {
          clock = sinon.useFakeTimers(Date.now());
        });

        afterEach(function() {
          clock.restore();
        });

        it("should touch the participant and return the next expiration.",
          function(done) {
            var startTime = parseInt(Date.now() / 1000, 10);
            createRoom(hawkCredentials).end(function(err, res) {
              if (err) throw err;
              var roomToken = res.body.roomToken;
              joinRoom(hawkCredentials, roomToken).end(function(err) {
                if (err) throw err;
                clock.tick(1000);
                refreshRoom(hawkCredentials, roomToken).end(function(err) {
                  if (err) throw err;
                  getRoomInfo(hawkCredentials, roomToken).end(function(err, res) {
                    if (err) throw err;
                    expect(res.body.creationTime).to.be.gte(startTime);
                    done();
                  });
                });
              });
            });
          });
      });

      describe("Handle 'leave'", function() {
        it("should remove the participant from the room.", function(done) {
          createRoom(hawkCredentials).end(function(err, res) {
            if (err) throw err;
            var roomToken = res.body.roomToken;
            joinRoom(hawkCredentials, roomToken).end(function(err) {
              if (err) throw err;
              leaveRoom(hawkCredentials, roomToken).end(function(err) {
                if (err) throw err;
                getRoomInfo(hawkCredentials, roomToken).end(
                  function(err, getRes) {
                    if (err) throw err;
                    expect(getRes.body.participants).to.length(0);
                    done();
                  });
              });
            });
          });
        });

        it("should notify all the room owner devices.", function(done) {
          register(hawkCredentials, "http://notmyidea.org").end(function(err) {
            if (err) throw err;
            register(hawkCredentials2, "http://notmyidea2.org").end(function(err) {
              if (err) throw err;
              createRoom(hawkCredentials).end(function(err, res) {
                if (err) throw err;
                var roomToken = res.body.roomToken;
                generateHawkCredentials(storage, 'Julie', function(julieCredentials) {
                  joinRoom(julieCredentials, roomToken).end(function(err) {
                    if (err) throw err;
                    requests = [];
                    var leaveTime = parseInt(Date.now() / 1000, 10);
                    leaveRoom(julieCredentials, roomToken).end(function(err) {
                      if (err) throw err;
                      expect(requests).to.length(2);
                      expect(requests[0].url).to.match(/http:\/\/notmyidea/);
                      expect(requests[0].form.version).to.gte(leaveTime);
                      done()
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    describe("Using Token", function() {
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
              .type('json');
            done();
          });
      });

      it("should fails if action is missing", function(done) {
       postReq
          .send({})
          .expect(400)
          .end(function(err, res) {
            if (err) throw err;
            expectFormattedError(res, 400, errors.MISSING_PARAMETERS,
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
              expectFormattedError(res, 400, errors.MISSING_PARAMETERS,
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

        it("should reject new participant if new participant clientMaxSize is " +
           "lower or equal to the current number of participants.", function(done) {
             createRoom(hawkCredentials).end(function(err, res) {
               if (err) throw err;
               var roomToken = res.body.roomToken;
               joinRoom(null, roomToken).end(function(err) {
                 if (err) throw err;
                 joinRoom(null, roomToken, {
                   displayName: "Natim",
                   clientMaxSize: 1
                 }, 400).end(function(err, res) {
                   if (err) throw err;
                   expectFormattedError(
                     res, 400, errors.CLIENT_REACHED_CAPACITY,
                     "Too many participants in the room for you to handle."
                   );
                   done();
                 });
               });
             });
           });

        it("should reject new participant if the room clientMaxSize is already reached.",
          function(done) {
            createRoom(hawkCredentials).end(function(err, res) {
               if (err) throw err;
               var roomToken = res.body.roomToken;
               // Alexis joins
               joinRoom(null, roomToken).end(function(err) {
                 if (err) throw err;
                 sessionToken = conf.get("fakeCallInfo").token2;
                 // Natim joins
                 joinRoom(null, roomToken, {
                   displayName: "Natim",
                   clientMaxSize: 2
                 }, 200).end(function(err) {
                   if (err) throw err;
                   sessionToken = conf.get("fakeCallInfo").token3;
                   // Julie tries to joins
                   joinRoom(null, roomToken, {
                     displayName: "Julie",
                     clientMaxSize: 3
                   }, 400).end(function(err, res) {
                     if (err) throw err;
                     expectFormattedError(
                       res, 400, errors.ROOM_FULL,
                       "The room is full."
                     );
                     done();
                   });
                 });
               });
             });
          });

        it("should notify all the room owner devices.", function(done) {
            register(hawkCredentials2, spurl + "2").end(function(err) {
              if (err) throw err;
              createRoom(hawkCredentials).end(function(err, res) {
                if (err) throw err;
                var roomToken = res.body.roomToken;
                requests = [];
                var joinTime = parseInt(Date.now() / 1000, 10);
                joinRoom(null, roomToken).end(function(err) {
                  if (err) throw err;
                  expect(requests).to.length(2);
                  expect(requests[0].url).to.match(/http:\/\/notmyidea/);
                  expect(requests[0].form.version).to.gte(joinTime);
                  done()
                });
              });
            });
        });
      });

      describe("Handle 'refresh'", function() {
        var clock;

        // Should touch the participant expiracy
        beforeEach(function() {
          clock = sinon.useFakeTimers(Date.now());
        });

        afterEach(function() {
          clock.restore();
        });

        it("should touch the participant and return the next expiration.",
          function(done) {
            var startTime = parseInt(Date.now() / 1000, 10);
            createRoom(hawkCredentials).end(function(err, res) {
              if (err) throw err;
              var roomToken = res.body.roomToken;
              joinRoom(null, roomToken).end(function(err, res) {
                if (err) throw err;
                var credentials = {
                  token: res.body.sessionToken
                };
                clock.tick(1000);
                refreshRoom(credentials, roomToken).end(function(err) {
                  if (err) throw err;
                  getRoomInfo(hawkCredentials, roomToken).end(function(err, res) {
                    if (err) throw err;
                    expect(res.body.creationTime).to.be.gte(startTime);
                    done();
                  });
                });
              });
            });
          });
      });

      describe("Handle 'leave'", function() {
        it("should remove the participant from the room.", function(done) {
          createRoom(hawkCredentials).end(function(err, res) {
            if (err) throw err;
            var roomToken = res.body.roomToken;
            joinRoom(null, roomToken).end(function(err, res) {
              if (err) throw err;
              var credentials = {
                token: res.body.sessionToken
              };
              leaveRoom(credentials, roomToken).end(function(err) {
                if (err) throw err;
                getRoomInfo(hawkCredentials, roomToken).end(
                  function(err, getRes) {
                    if (err) throw err;
                    expect(getRes.body.participants).to.length(0);
                    done();
                  });
              });
            });
          });
        });

        it("should notify all the room owner devices.", function(done) {
          register(hawkCredentials, "http://notmyidea.org").end(function(err) {
            if (err) throw err;
            register(hawkCredentials2, "http://notmyidea2.org").end(function(err) {
              if (err) throw err;
              createRoom(hawkCredentials).end(function(err, res) {
                if (err) throw err;
                var roomToken = res.body.roomToken;
                generateHawkCredentials(storage, 'Julie', function(julieCredentials) {
                  joinRoom(julieCredentials, roomToken).end(function(err) {
                    if (err) throw err;
                    requests = [];
                    var leaveTime = parseInt(Date.now() / 1000, 10);
                    leaveRoom(julieCredentials, roomToken).end(function(err) {
                      if (err) throw err;
                      expect(requests).to.length(2);
                      expect(requests[0].url).to.match(/http:\/\/notmyidea/);
                      expect(requests[0].form.version).to.gte(leaveTime);
                      done()
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    describe("Participants", function() {
      it("should expire automatically.", function(done) {
        createRoom(hawkCredentials).end(function(err, res) {
          if (err) throw err;
          var roomToken = res.body.roomToken;
          generateHawkCredentials(storage, 'Julie',
            function(julieCredentials, julieHawkIdHmac) {
              joinRoom(julieCredentials, roomToken).end(function(err) {
                if (err) throw err;
                // Touch the participant value for a small time.
                storage.touchRoomParticipant(roomToken, julieHawkIdHmac, 0.01,
                  function(err, success) {
                    if (err) throw err;
                    expect(success).to.eql(true);
                    getRoomInfo(hawkCredentials, roomToken).end(
                      function(err, res) {
                        if (err) throw err;
                        expect(res.body.participants).to.length(1);
                        setTimeout(function() {
                          getRoomInfo(hawkCredentials, roomToken).end(
                            function(err, res) {
                              if (err) throw err;
                              expect(res.body.participants).to.length(0);
                              done();
                            });
                        }, 15);
                      });
                  });
              });
            });
        });
      });
    });
  });

  describe("DELETE /rooms/:token", function() {
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
        });
      });
    });

    it("should delete room if the user is the room owner", function(done) {
      createRoom(hawkCredentials).end(function(err, res) {
        if (err) throw err;
        var roomToken = res.body.roomToken;
        requests = [];
        deleteRoom(hawkCredentials, roomToken).end(function(err) {
          if (err) throw err;
          expect(requests).to.length(1);
          getRoomInfo(hawkCredentials, roomToken, 404).end(done);
        });
      });
    });
  });

  describe("GET /rooms", function() {
    var clock;

    beforeEach(function() {
      clock = sinon.useFakeTimers(Date.now());
    });

    afterEach(function() {
      clock.restore();
    });

    it("should return the list of user rooms with current number of " +
      "participants", function(done) {
        var startTime = parseInt(Date.now() / 1000, 10);
        createRoom(hawkCredentials).end(function(err, res) {
          if (err) throw err;
          var roomToken = res.body.roomToken;
          joinRoom(hawkCredentials, roomToken).end(function(err) {
            if (err) throw err;
            getUserRoomsInfo(hawkCredentials).end(
              function(err, res) {
                if (err) throw err;
                expect(res.body).to.length(1);
                expect(res.body[0].ctime).to.be.gte(startTime);
                delete res.body[0].ctime;
                var roomWebappUrl = conf.get('rooms').webAppUrl
                  .replace('{token}', roomToken);
                expect(res.body[0]).to.eql({
                  roomToken: roomToken,
                  roomUrl: roomWebappUrl,
                  roomName: 'UX discussion',
                  maxSize: 3,
                  currSize: 1
                });
                done();
              });
          });
        });
      });

    it("should return a 503 if the database errors out", function(done) {
      sandbox.stub(storage, "getUserRooms", function(user, callback) {
        callback("error");
      });

      createRoom(hawkCredentials).end(function(err) {
        if (err) throw err;
        getUserRoomsInfo(hawkCredentials, 0, 503).end(done);
      });
    });

    it("should only return the rooms with a timestamp greather than version.",
     function(done) {
        createRoom(hawkCredentials).end(function(err) {
          if (err) throw err;
          clock.tick(1000);
          var secondRoomStartTime = parseInt(Date.now() / 1000, 10);
          createRoom(hawkCredentials).end(function(err) {
            if (err) throw err;
            getUserRoomsInfo(hawkCredentials, secondRoomStartTime).end(
              function(err, res) {
                if (err) throw err;
                expect(res.body).to.length(1);
                expect(res.body[0].ctime).to.be.gte(secondRoomStartTime);
                done();
              });
          });
        });
     });
  });
});
