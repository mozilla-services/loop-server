/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var expect = require("chai").expect;
var assert = require("chai").assert;
var randomBytes = require("crypto").randomBytes;
var sinon = require("sinon");

var getStorage = require("../loop/storage");
var conf = require("../loop").conf;
var crypto = require("crypto");
var hmac = require("../loop/hmac");
var constants = require("../loop/constants");
var generateToken = require("../loop/tokenlib").generateToken;

var uuid = "1234";
var user = "alexis@notmyidea.com";
var userMac = hmac(user, conf.get("userMacSecret"));
var idHmac = crypto.randomBytes(16).toString('hex');
var idHmac2 = crypto.randomBytes(16).toString('hex');
var callerId = 'natim@mozilla.com';
var simplePushURL = "https://push.mozilla.com/test";
var simplePushURL2 = "https://push.mozilla.com/test2";
var fakeCallInfo = conf.get("fakeCallInfo");
var callUrls = conf.get('callUrls');

var ttl = 30;

describe("Storage", function() {
  function testStorage(name, createStorage) {
    var now = parseInt(Date.now() / 1000, 10);
    var storage,
        a_second = 1 / 3600,  // A second in hours.
        calls = [
        {
          callId: randomBytes(16).toString("hex"),
          callerId: callerId,
          userMac: userMac,
          sessionId: fakeCallInfo.session1,
          calleeToken: fakeCallInfo.token1,
          callState: constants.CALL_STATES.INIT,
          timestamp: now - 3
        },
        {
          callId: randomBytes(16).toString("hex"),
          callerId: callerId,
          userMac: userMac,
          sessionId: fakeCallInfo.session2,
          calleeToken: fakeCallInfo.token2,
          callState: constants.CALL_STATES.INIT,
          timestamp: now - 2
        },
        {
          callId: randomBytes(16).toString("hex"),
          callerId: callerId,
          userMac: userMac,
          sessionId: fakeCallInfo.session3,
          calleeToken: fakeCallInfo.token2,
          callState: constants.CALL_STATES.TERMINATED,
          timestamp: now - 1
        }
      ],
      call = calls[0],
      urls = [
        {
          timestamp: now,
          expires: now + callUrls.timeout,
          userMac: userMac
        },
        {
          timestamp: now + 1,
          expires: now + callUrls.timeout,
          userMac: userMac
        },
        {
          timestamp: now + 2,
          expires: now + callUrls.timeout,
          userMac: userMac
        }
      ],
    urlData = urls[0],
    callToken = generateToken(callUrls.tokenSize),
    roomToken = generateToken(conf.get("rooms").tokenSize),
    roomData = {
      sessionId: fakeCallInfo.session1,
      roomName: "UX Discussion",
      roomOwner: "Alexis",
      roomOwnerHmac: userMac,
      maxSize: 3,
      expiresAt: now + 60 * 24,
      updateTime: now,
      creationTime: now
    };

    describe(name, function() {
      var sandbox;

      beforeEach(function() {
        storage = createStorage({
          tokenDuration: conf.get('tokBox').tokenDuration,
          roomExtendTTL: conf.get('rooms').extendTTL,
          hawkSessionDuration: conf.get('hawkSessionDuration'),
          callDuration: conf.get('callDuration'),
          maxSimplePushUrls: conf.get('maxSimplePushUrls'),
          roomsDeletedTTL: conf.get('rooms').deletedTTL
        });
        sandbox = sinon.sandbox.create();
      });

      afterEach(function(done) {
        sandbox.restore();
        storage.drop(function(err) {
          // Remove the storage reference so tests blow up in an explicit way.
          storage = undefined;
          done(err);
        });
      });

      describe('#revokeURLToken', function() {
        it("should add a revoked url", function(done) {
          storage.revokeURLToken({uuid: uuid, expires: a_second},
            function(err) {
              if (err) throw err;
              storage.getCallUrlData(uuid, function(err, value){
                expect(value).to.equal(null);
                done(err);
              });
            });
        });
      });

      describe("#addUserSimplePushURLs", function() {
        it("should be able to add a user simple push URL", function(done) {
          storage.addUserSimplePushURLs(userMac, idHmac, {
            calls: simplePushURL,
            rooms: simplePushURL2
          }, function(err) {
            if (err) throw err;
            storage.getUserSimplePushURLs(userMac, function(err, urls) {
              expect(urls.calls).to.have.length(1);
              expect(urls.calls).to.eql([simplePushURL]);
              expect(urls.rooms).to.have.length(1);
              expect(urls.rooms).to.eql([simplePushURL2]);
              done(err);
            });
          });
        });

        it("should not overwrite existing simple push URLs", function(done) {
          storage.addUserSimplePushURLs(userMac, idHmac, {
            calls: simplePushURL,
            rooms: simplePushURL
          }, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURLs(userMac, "5678", {
              calls: simplePushURL2,
              rooms: simplePushURL2
            }, function(err) {
              if (err) throw err;
              storage.getUserSimplePushURLs(userMac, function(err, urls) {
                expect(urls.calls).to.have.length(2);
                expect(urls.calls).to.contain(simplePushURL);
                expect(urls.calls).to.contain(simplePushURL2);

                expect(urls.rooms).to.have.length(2);
                expect(urls.rooms).to.contain(simplePushURL);
                expect(urls.rooms).to.contain(simplePushURL2);
                done(err);
              });
            });
          });
        });

        it("should dedupe URLs", function(done) {
          storage.addUserSimplePushURLs(userMac, idHmac, {
            calls: simplePushURL,
            rooms: simplePushURL2
          }, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURLs(userMac, idHmac2, {
              calls: simplePushURL,
              rooms: simplePushURL2
            }, function(err) {
              if (err) throw err;
              storage.getUserSimplePushURLs(userMac, function(err, urls) {
                  expect(urls.calls).to.have.length(1);
                  expect(urls.calls).to.contain(simplePushURL);
                  expect(urls.rooms).to.have.length(1);
                  expect(urls.rooms).to.contain(simplePushURL2);
                  done(err);
                });
              });
          });
        });

      });

      describe("#getUserSimplePushURLs", function() {
        it("should return empty lists if nothing had been registered",
          function(done) {
            storage.getUserSimplePushURLs("does-not-exist",
              function(err, urls) {
                if (err) throw err;
                expect(urls).to.eql({calls: [], rooms: []});
                done();
              });
          });
      });

      describe("#removeSimplePushURLs", function() {
        it("should delete an existing simple push URL", function(done) {
          storage.addUserSimplePushURLs(userMac, idHmac, {calls: simplePushURL}, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURLs(userMac, idHmac2, {calls: simplePushURL2},
              function(err) {
                if (err) throw err;
                storage.removeSimplePushURLs(userMac, idHmac2,
                  function(err) {
                    if (err) throw err;
                    storage.getUserSimplePushURLs(userMac,
                      function(err, urls) {
                        if (err) throw err;
                        expect(urls.calls.length).to.eql(1);
                        expect(urls.calls).to.not.contain(simplePushURL2);
                        done();
                      });
                  });
              });
          });
        });
      });

      describe("#deleteUserSimplePushURLs", function() {
        it("should delete all existing simple push URLs", function(done) {
          storage.addUserSimplePushURLs(userMac, idHmac, {calls: simplePushURL}, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURLs(userMac, idHmac2, {calls: simplePushURL2},
              function(err) {
                if (err) throw err;
                storage.deleteUserSimplePushURLs(userMac, function(err) {
                  if (err) throw err;
                  storage.getUserSimplePushURLs(userMac, function(err, urls) {
                    if (err) throw err;
                    expect(urls.calls).to.length(0);
                    done();
                  });
                });
              });
          });
        });
      });

      describe("#addUserCallUrlData", function() {
        it("should be able to add one call-url to the store", function(done) {
          storage.addUserCallUrlData(userMac, callToken, urlData, function(err) {
            if (err) throw err;
            storage.getUserCallUrls(userMac, function(err, results) {
              if (err) throw err;
              expect(results).to.have.length(1);
              expect(results).to.eql([urlData]);
              done();
            });
          });
        });

        it("should require a timestamp property for the urlData",
          function(done) {
            var invalidData = JSON.parse(JSON.stringify(urlData));
            invalidData.timestamp = undefined;
            storage.addUserCallUrlData(userMac, callToken, invalidData,
              function(err) {
                expect(err.message)
                  .eql("urlData.timestamp should not be undefined");
                done();
              });
          });
      });

      describe("#updateUserCallUrlData", function() {
        it("should error in case there is no existing calls for this user",
          function(done) {
            storage.updateUserCallUrlData(userMac, callToken, urlData,
            function(err) {
              assert(err.notFound);
              done();
            });
          });

        it("should update an existing call", function(done) {
          storage.addUserCallUrlData(userMac, callToken, urlData, function(err) {
            if (err) throw err;
            var updatedData = JSON.parse(JSON.stringify(urlData));
            updatedData.callerId = "natim@moz";
            updatedData.issuer = "alexis@moz";
            storage.updateUserCallUrlData(userMac, callToken, updatedData,
              function(err) {
                expect(err).to.eql(null);
                storage.getCallUrlData(callToken, function(err, data) {
                  if (err) throw err;
                  expect(data).eql({
                    callerId: "natim@moz",
                    issuer: "alexis@moz",
                    expires: urlData.expires,
                    timestamp: urlData.timestamp,
                    userMac: urlData.userMac
                  });
                  done();
                });
              });
          });
        });
      });

      describe("#getUserCallUrls", function() {
        it("should keep a list of the user urls", function(done) {
          var token1 = generateToken(callUrls.tokenSize);
          storage.addUserCallUrlData(
            userMac,
            token1,
            urls[0],
            function() {
              storage.addUserCallUrlData(
                userMac,
                generateToken(callUrls.tokenSize),
                urls[1],
                function() {
                  storage.addUserCallUrlData(
                    userMac,
                    generateToken(callUrls.tokenSize),
                    urls[2],
                    function() {
                      storage.getUserCallUrls(userMac, function(err, results) {
                        if (err) throw err;
                        expect(results).to.have.length(3);
                        expect(results).to.eql(urls);
                        storage.revokeURLToken(token1, function(err) {
                          if (err) throw err;
                          storage.getUserCallUrls(userMac, function(err, results) {
                            if (err) throw err;
                            expect(results).to.have.length(2);
                            done();
                          });
                        });
                      });
                    });
                });
            });
        });

        it("should return an empty list if no urls", function(done) {
          storage.getUserCallUrls(userMac, function(err, results) {
            expect(results).to.eql([]);
            done(err);
          });
        });
      });

      describe("#getCallUrlData", function() {
        it("should be able to list a call-url by its id", function(done) {
          storage.addUserCallUrlData(userMac, callToken, urlData, function(err) {
            if (err) throw err;
            storage.getCallUrlData(callToken, function(err, result) {
              if (err) throw err;
              expect(result).to.eql(urlData);
              done();
            });
          });
        });

        it("should return null if the call-url doesn't exist", function(done) {
          storage.getCall("does-not-exist", function(err, call) {
            if (err) throw err;
            expect(call).to.eql(null);
            done();
          });
        });
      });

      describe("#deleteUserCallUrls", function() {
        it("should delete all call data for a given user", function(done){
          storage.addUserCallUrlData(
            userMac,
            generateToken(callUrls.tokenSize),
            urls[0],
            function() {
              storage.addUserCallUrlData(
                userMac,
                generateToken(callUrls.tokenSize),
                urls[1],
                function() {
                  storage.addUserCallUrlData(
                    userMac,
                    generateToken(callUrls.tokenSize),
                    urls[2],
                    function() {
                      storage.deleteUserCallUrls(userMac, function(err) {
                        if (err) throw err;
                        storage.getUserCallUrls(userMac,
                          function(err, results) {
                            if (err) throw err;
                            expect(results).to.have.length(0);
                            done();
                          });
                      });
                    });
                });
            });
        });
      });

      describe("#addUserCalls", function() {
        it("should be able to add one call to the store", function(done) {
          storage.addUserCall(userMac, call, function(err) {
            if (err) throw err;
            storage.getUserCalls(userMac, function(err, results) {
              if (err) throw err;
              expect(results).to.have.length(1);
              expect(results).to.eql([call]);
              storage.deleteCall(call.callId, function(err) {
                if (err) throw err;
                storage.getUserCalls(userMac, function(err, results) {
                  if (err) throw err;
                  expect(results).to.have.length(0);
                  done();
                });
              });
            });
          });
        });
      });

      describe("#getUserCalls", function() {
        it("should keep a list of the user calls", function(done) {
          storage.addUserCall(userMac, calls[0], function(err) {
            if (err) throw err;
            storage.addUserCall(userMac, calls[1], function(err) {
              if (err) throw err;
              storage.addUserCall(userMac, calls[2], function(err) {
                if (err) throw err;
                storage.getUserCalls(userMac, function(err, results) {
                  if (err) throw err;
                  expect(results).to.have.length(3);
                  expect(results).to.eql(calls.map(function(call, key) {
                    if (key === 2) {
                      call.callState = constants.CALL_STATES.TERMINATED;
                    } else {
                      call.callState = constants.CALL_STATES.INIT;
                    }
                    return call;
                  }));
                  done();
                });
              });
            });
          });
        });

        it("should return an empty list if no calls", function(done) {
          storage.getUserCalls(userMac, function(err, results) {
            expect(results).to.eql([]);
            done(err);
          });
        });
      });

      describe("#getCall", function() {
        it("should be able to list a call by its id", function(done) {
          storage.addUserCall(userMac, call, function(err) {
            if (err) throw err;
            storage.getCall(call.callId, function(err, result) {
              if (err) throw err;
              expect(result).to.eql(call);
              done();
            });
          });
        });

        it("should return null if the call doesn't exist", function(done) {
          storage.getCall("does-not-exist", function(err, call) {
            if (err) throw err;
            expect(call).to.eql(null);
            done();
          });
        });
      });

      describe("#deleteCall", function() {
        it("should delete an existing call", function(done) {
          storage.addUserCall(userMac, call, function(err) {
            if (err) throw err;
            storage.deleteCall(call.callId, function(err, result) {
              if (err) throw err;
              assert(result);
              storage.getCall(call.callId, function(err, result) {
                if (err) throw err;
                expect(result).to.equal(null);
                done(err);
              });
            });
          });
        });

        it("should return an error if the call doesn't exist", function(done) {
          storage.deleteCall("does-not-exist", function(err, result) {
            if (err) throw err;
            expect(result).to.eql(false);
            done();
          });
        });
      });

      describe("#deleteUserCalls", function() {
        it("should delete all calls of an user", function(done) {
          storage.addUserCall(userMac, calls[0], function(err) {
            if (err) throw err;
            storage.addUserCall(userMac, calls[1], function(err) {
              if (err) throw err;
              storage.addUserCall(userMac, calls[2], function(err) {
                if (err) throw err;
                storage.deleteUserCalls(userMac, function(err) {
                  if (err) throw err;
                  storage.getUserCalls(userMac, function(err, results) {
                    if (err) throw err;
                    expect(results).to.have.length(0);
                    done();
                  });
                });
              });
            });
          });
        });

        it("should not error when no calls exist", function(done) {
          storage.deleteUserCalls(userMac, done);
        });
      });

      describe("#getHawkSession", function() {
        it("should return null if the hawk session doesn't exist",
          function(done) {
            storage.getHawkSession("does-not-exist", function(err, result) {
              if (err) throw err;
              expect(result).to.eql(null);
              done();
            });
          });
      });

      describe("#setHawkSession", function() {
        it("should return a valid hawk session", function(done) {
          storage.setHawkSession("id", "key", function(err) {
            if (err) throw err;
            storage.getHawkSession("id", function(err, result) {
              if (err) throw err;
              expect(result).to.eql({
                key: "key",
                algorithm: "sha256"
              });
              done();
            });
          });
        });
      });

      describe("#deleteHawkSession", function() {
        it("should delete an existing hawk session", function(done) {
          storage.setHawkSession("id", "key", function(err) {
            if (err) throw err;
            storage.deleteHawkSession("id", function(err) {
              if (err) throw err;
              storage.getHawkSession("id", function(err, result) {
                if (err) throw err;
                expect(result).to.eql(null);
                done();
              });
            });
          });
        });
      });

      describe("#setHawkUser, #getHawkUser", function() {
        it("should store and retrieve an user hawk session", function(done) {
          storage.setHawkUser("userhash", "tokenid", function(err) {
            if (err) throw err;
            storage.getHawkUser("tokenid", function(err, result) {
              if (err) throw err;
              expect(result).to.eql("userhash");
              done();
            });
          });
        });
      });

      describe("#setHawkUserId, #getHawkUserId", function() {
        it("should store and retrieve an user hawk session", function(done) {
          storage.setHawkUserId("tokenId", "userId", function(err) {
            if (err) throw err;
            storage.getHawkUserId("tokenId", function(err, result) {
              if (err) throw err;
              expect(result).to.eql("userId");
              done();
            });
          });
        });
      });

      describe("#deleteHawkUserId", function() {
        it("should delete an existing user hawk session", function(done) {
          storage.setHawkUserId("tokenId", "userId", function(err) {
            if (err) throw err;
            storage.deleteHawkUserId("tokenId", function(err) {
              if (err) throw err;
              storage.getHawkUserId("tokenId", function(err, result) {
                if (err) throw err;
                expect(result).to.eql(null);
                done();
              });
            });
          });
        });
      });

      describe("#setCallState", function() {
        it("should set the call state", function(done) {
          storage.addUserCall(userMac, call, function(err) {
            if (err) throw err;
            storage.setCallState(call.callId, constants.CALL_STATES.INIT, 10,
              function(err) {
                if (err) throw err;
                storage.getCallState(call.callId, function(err, state) {
                  if (err) throw err;
                  expect(state).to.eql(constants.CALL_STATES.INIT);
                  done();
                });
              });
          });
        });

        it("should check the states are valid before storing them",
          function(done) {
            storage.addUserCall(userMac, call, function(err) {
              if (err) throw err;
              storage.setCallState(call.callId,
                constants.CALL_STATES.TERMINATED + ":unauthorized",
                function(err) {
                  expect(err).to.not.eql(null);
                  expect(err.message).match(/should be one of/);
                  done();
                });
            });
          });
      });

      describe("#getCallState", function() {
        it("should return null when no call state is set", function(done) {
          storage.getCallState("12345", function(err, state) {
            if (err) throw err;
            expect(state).to.eql(null);
            done();
          });
        });
      });

      describe("#setCallTerminationReason", function() {
        it("should set the call termination reason", function(done) {
          storage.addUserCall(userMac, call, function(err) {
            if (err) throw err;
            storage.setCallTerminationReason(call.callId,
              constants.MESSAGE_REASONS.BUSY, function(err) {
                if (err) throw err;
                storage.getCallTerminationReason(call.callId, function(err, reason) {
                  if (err) throw err;
                  expect(reason).to.eql(constants.MESSAGE_REASONS.BUSY);
                  done();
                });
              });
          });
        });
      });

      describe("#getCallTerminationReason", function() {
        it("should return null when no call reason is set", function(done) {
          storage.getCallTerminationReason("12345", function(err, reason) {
            if (err) throw err;
            expect(reason).to.eql(null);
            done();
          });
        });
      });

      describe("#setRoomAccessToken", function() {
        it("should set the user roomToken", function(done) {
          storage.setRoomAccessToken(idHmac, idHmac2, 1, function(err) {
            if (err) throw err;
            storage.isRoomAccessTokenValid(idHmac, idHmac2, function(err, isValid) {
              if (err) throw err;
              expect(isValid).to.eql(true);
              done();
            });
          });
        });
      });

      describe("#isRoomAccessTokenValid", function() {
        it("should return false if the Room Token doesn't exists", function(done) {
          storage.isRoomAccessTokenValid("12345", "wrong-token", function(err, isValid) {
            if (err) throw err;
            expect(isValid).to.eql(false);
            done();
          });
        });

        it("should return false if the Room Token has expired", function(done) {
          storage.setRoomAccessToken(idHmac, idHmac2, 0.01, function(err) {
            if (err) throw err;
            storage.isRoomAccessTokenValid(idHmac, idHmac2, function(err, isValid) {
              if (err) throw err;
              expect(isValid).to.eql(true);
              setTimeout(function() {
                storage.isRoomAccessTokenValid("12345", idHmac2, function(err, isValid) {
                  if (err) throw err;
                  expect(isValid).to.eql(false);
                  done();
                });
              }, 15);
            });
          });
        });
      });

      describe("#ping", function() {
        it("should return true if we are connected", function(done) {
          storage.ping(function(connected) {
            assert(connected);
            done();
          });
        });
      });

      describe("#setUserRoomData", function() {
        it("should be able to add one room to the store", function(done) {
          storage.setUserRoomData(userMac, roomToken, roomData, function(err) {
            if (err) throw err;
            storage.getRoomData(roomToken, function(err, storedRoomData) {
              if (err) throw err;
              roomData.roomToken = roomToken;
              expect(storedRoomData).to.eql(roomData);
              done();
            });
          });
        });

        it("should require an expiresAt property for the roomData",
          function(done) {
            var invalidData = JSON.parse(JSON.stringify(roomData));
            invalidData.expiresAt = undefined;
            storage.setUserRoomData(userMac, roomToken, invalidData,
              function(err) {
                expect(err.message)
                  .eql("roomData.expiresAt should not be undefined");
                done();
              });
          });
      });

      describe("#touchRoomData", function() {
        it("should update the room expiresAt and updateTime as well as the TTL",
          function(done) {
            storage.setUserRoomData(userMac, roomToken, roomData, function(err) {
              if (err) throw err;
              var start = parseInt(Date.now() / 1000, 10);
              storage.touchRoomData(roomToken, function(err) {
                if (err) throw err;
                storage.getRoomData(roomToken, function(err, storedRoomData) {
                  if (err) throw err;
                  expect(storedRoomData.updateTime).to.gte(start);
                  expect(storedRoomData.expiresAt).to.gte(
                    start + conf.get('rooms').extendTTL * 3600);
                  done();
                });
              });
            });
          });

        it("should not fail if the room doesn't exists", function(done) {
          storage.touchRoomData(roomToken, function(err) {
            if (err) throw err;
            done();
          });
        });
      });

      describe("#deleteRoomsData", function() {
        it("should remove rooms from the store", function(done) {
          storage.setUserRoomData(userMac, roomToken, roomData, function(err) {
            if (err) throw err;
            var roomToken2 = generateToken(conf.get("rooms").tokenSize);
            storage.setUserRoomData(userMac, roomToken2, roomData,
              function(err) {
                if (err) throw err;
                storage.deleteRoomsData([roomToken, roomToken2], function(err) {
                  if (err) throw err;
                  storage.getUserRooms(userMac, function(err, rooms) {
                    if (err) throw err;
                    expect(rooms).to.eql([]);
                    done();
                  });
                });
              });
          });
        });

        it("should remove rooms from the store and ignore expired ones.", function(done) {
          var roomToken2 = generateToken(conf.get("rooms").tokenSize);
          storage.deleteRoomsData([roomToken2], function(err) {
            if (err) throw err;
            done();
          });
        });

        it("should save the room deletion notification", function(done) {
          storage.setUserRoomData(userMac, roomToken, roomData, function(err) {
            if (err) throw err;
            var roomToken2 = generateToken(conf.get("rooms").tokenSize);
            storage.setUserRoomData(userMac, roomToken2, roomData,
              function(err) {
                if (err) throw err;
                storage.deleteRoomsData([roomToken, roomToken2], function(err) {
                  if (err) throw err;
                  storage.getUserDeletedRooms(userMac, function(err, deletedRooms) {
                    if (err) throw err;
                    expect(deletedRooms).to.eql([roomToken, roomToken2]);
                    done();
                  });
                });
              });
          });
        });
      });

      describe("#getUserDeletedRooms", function() {
        var clock;

        beforeEach(function() {
          clock = sinon.useFakeTimers(Date.now());
        });

        afterEach(function() {
          clock.restore();
        });

        it("should remove expired notification", function(done) {
          storage.setUserRoomData(userMac, roomToken, roomData, function(err) {
            if (err) throw err;
            storage.deleteRoomData(roomToken, function(err) {
              if (err) throw err;
              clock.tick(30 * 3600 * 1000); // 30 minutes later
              storage.getUserDeletedRooms(userMac, function(err, deletedRooms) {
                if (err) throw err;
                expect(deletedRooms).to.eql([]);
                done();
              });
            });
          });
        });
      });

      describe("#deleteRoomParticipants", function() {
        it("should remove all the room participants", function(done) {
          storage.addRoomParticipant(roomToken, idHmac, {"apiKey": "1"}, 30,
            function(err) {
              if (err) throw err;
              storage.deleteRoomParticipants(roomToken, function(err) {
                if (err) throw err;
                storage.getRoomParticipants(roomToken,
                  function(err, participants) {
                    if (err) throw err;
                    expect(participants).to.length(0);
                    done();
                  });
              });
            });
        });
      });

      describe("#addRoomParticipant", function() {
        it("should add a participant to the room", function(done) {
          storage.addRoomParticipant(roomToken, idHmac, {"apiKey": "1"}, ttl,
            function(err) {
              if (err) throw err;
              storage.addRoomParticipant(roomToken, idHmac2, {"apiKey": "2"}, ttl,
                function(err) {
                  if (err) throw err;
                  storage.getRoomParticipants(roomToken, function(err, results) {
                    if (err) throw err;
                    expect(results).to.contain({"apiKey": "1", "hawkIdHmac": idHmac});
                    expect(results).to.contain({"apiKey": "2", "hawkIdHmac": idHmac2});
                    done();
                  });
                });
            });
        });
      });

      describe("#touchRoomParticipant", function() {

        it("should change the room participant expiricy", function(done) {
          var participantTTL = conf.get('rooms').participantTTL;
          storage.addRoomParticipant(roomToken, idHmac, {"apiKey": "1"}, 30,
            function(err) {
              if (err) throw err;
              storage.touchRoomParticipant(roomToken, idHmac, participantTTL,
                function(err, success) {
                if (err) throw err;
                expect(success).to.eql(true);
                setTimeout(function() {
                  storage.touchRoomParticipant(roomToken, idHmac, participantTTL,
                    function(err, success) {
                      if (err) return done(err);
                      expect(success).to.eql(false);
                      storage.getRoomParticipants(roomToken, function(err, results) {
                        if (err) throw err;
                        expect(results).to.length(0);
                        done();
                      });
                  });
                }, participantTTL * 1000 + 150);
              });
            });
        });

        it("should change the room participant access token", function(done) {
          storage.addRoomParticipant(roomToken, idHmac, {"apiKey": "1"}, 30,
            function(err) {
              if (err) throw err;
              storage.setRoomAccessToken(roomToken, idHmac, 30, function(err) {
                if (err) throw err;
                storage.touchRoomParticipant(roomToken, idHmac, 0.01, function(err, success) {
                  if (err) throw err;
                  expect(success).to.eql(true);
                  // We need to stop the fakeTimers in order to have setTimeout working
                  setTimeout(function() {
                    // Then we fake it again.
                    storage.isRoomAccessTokenValid(roomToken, idHmac, function(err, success) {
                      if (err) throw err;
                      expect(success).to.eql(false);
                      done();
                    });
                  }, 15);
                });
              });
            });
        });
      });

      describe("#deleteRoomParticipant", function() {
        it("should remove a participant to the room", function(done) {
          storage.addRoomParticipant(roomToken, idHmac, {"apiKey": "1"}, ttl,
            function(err) {
              if (err) throw err;
              storage.addRoomParticipant(roomToken, idHmac2, {"apiKey": "2"}, ttl,
                function(err) {
                  if (err) throw err;
                  storage.deleteRoomParticipant(roomToken, idHmac, function(err) {
                    if (err) throw err;
                    storage.getRoomParticipants(roomToken, function(err, results) {
                      if (err) throw err;
                      expect(results).to.not.contain({"apiKey": "1", "hawkIdHmac": idHmac});
                      expect(results).to.contain({"apiKey": "2", "hawkIdHmac": idHmac2});
                      done();
                    });
                  });
                });
            });
        });

        it("should remove a participant access token", function(done) {
          storage.setRoomAccessToken(roomToken, idHmac, ttl, function(err) {
            if (err) throw err;
            storage.deleteRoomParticipant(roomToken, idHmac, function(err) {
              if (err) throw err;
              storage.isRoomAccessTokenValid(roomToken, idHmac, function(err, isValid) {
                if (err) throw err;
                expect(isValid).to.eql(false);
                done();
              });
            });
          });
        });
      });

      describe("#incrementConnectedCallDevices", function() {
        it("should increment the number of connected call devices, per type",
          function(done) {
            storage.incrementConnectedCallDevices("callee", roomToken,
              function(err) {
                if (err) throw err;
                storage.getConnectedCallDevices("callee", roomToken, function(err, count) {
                  if (err) throw err;
                  expect(count).to.eql(1);
                  done();
                });
              });
          });
      });

      describe("#touchHawkSession", function() {
        var oldDuration;

        beforeEach(function() {
          oldDuration = storage._settings.hawkSessionDuration;
          // First, setup keys with an expiration in the future (800s).
          storage._settings.hawkSessionDuration = 800;
        });

        afterEach(function() {
          storage._settings.hawkSessionDuration = oldDuration;
        });

        it("should touch user session and associated account data", function(done) {
          storage.setHawkSession(idHmac, "auth key", function(err) {
            if (err) throw err;
            storage.setHawkUser(userMac, idHmac, function(err) {
              if (err) throw err;
              storage.setHawkUserId(idHmac, "encrypted user id", function(err) {
                if (err) throw err;
                // Set the expiration at 0 so that it expires immediatly.
                storage._settings.hawkSessionDuration = 0;
                // Then, check that all the keys have been deleted.
                storage.touchHawkSession(userMac, idHmac, function(err) {
                  if (err) throw err;
                  storage.getHawkSession(idHmac, function(err, data) {
                    if (err) throw err;
                    expect(data).to.eql(null);
                    storage.getHawkUser(idHmac, function(err, data) {
                      if (err) throw err;
                      expect(data).to.eql(null);
                      storage.getHawkUserId(idHmac, function(err, data) {
                        if (err) throw err;
                        expect(data).to.eql(null);
                        done();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });

      describe("#decrementConnectedCallDevices", function() {
        it("should increment the number of connected call devices, per type",
          function(done) {
            storage.incrementConnectedCallDevices("callee", roomToken,
              function(err) {
                if (err) throw err;
                storage.decrementConnectedCallDevices("callee", roomToken, function(err) {
                  if (err) throw err;
                  storage.getConnectedCallDevices("callee", roomToken, function(err, count) {
                    if (err) throw err;
                    expect(count).to.eql(0);
                    done();
                  });
                });
              });
          });
      });

    });
  }

  // Test all the storages implementation.
  testStorage("Redis", function createRedisStorage(options) {
    return getStorage({engine: "redis", settings: {"db": 5}}, options);
  });

  testStorage("Redis migration", function(options) {
    return getStorage({
      engine: "redis",
      settings: {
        "host": "localhost",
        "port": 6379,
        "db": 5,
        "migrateFrom": {
          "host": "localhost",
          "port": 6379,
          "db": 4
        }
      }
    }, options);
  });

  describe("Redis specifics", function() {
    var sandbox, storage;

    beforeEach(function() {
      sandbox = sinon.sandbox.create();
      storage = getStorage({engine: "redis", settings: {"db": 5}}, {
          tokenDuration: conf.get('tokBox').tokenDuration,
          hawkSessionDuration: conf.get('hawkSessionDuration'),
          callDuration: conf.get('callDuration'),
          maxSimplePushUrls: conf.get('maxSimplePushUrls')
        });
    });

    afterEach(function() {
      sandbox.restore();
    });

    it("#ping should fails when redis is in read-only mode", function(done) {
      sandbox.stub(storage._client, "setex",
        function(key, ttl, value, callback){
          callback("Error: Redis is read-only");
        });
      storage.ping(function(connected) {
        expect(connected).to.be.false;
        done();
      });
    });

    it("should handle storage errors correctly.", function(done) {
      sandbox.stub(storage._client, "smembers",
        function(key, callback){
          callback("error");
        });

      storage.getUserCallUrls(userMac, function(err, results) {
        expect(err).to.eql("error");
        expect(typeof results).to.eql("undefined");
        done();
      });
    });
  });
});
