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
var hmac = require("../loop/hmac");
var constants = require("../loop/constants");
var generateToken = require("../loop/tokenlib").generateToken;

var uuid = "1234";
var user = "alexis@notmyidea.com";
var userMac = hmac(user, conf.get("userMacSecret"));
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
        calls = [
        {
          callId:       randomBytes(16).toString("hex"),
          callType:     "audio-video",
          callerId:     callerId,
          userMac:      userMac,
          sessionId:    fakeCallInfo.session1,
          apiKey:       fakeCallInfo.apiKey,
          calleeToken:  fakeCallInfo.token1,
          wsCallerToken: "caller",
          wsCalleeToken: "callee",
          callState:    constants.CALL_STATES.INIT,
          timestamp:    now - 3
        },
        {
          callId:       randomBytes(16).toString("hex"),
          callType:     "audio-video",
          callerId:     callerId,
          userMac:      userMac,
          sessionId:    fakeCallInfo.session2,
          apiKey:       fakeCallInfo.apiKey,
          calleeToken:  fakeCallInfo.token2,
          wsCallerToken: "caller",
          wsCalleeToken: "callee",
          callState:    constants.CALL_STATES.INIT,
          timestamp:    now - 2
        },
        {
          callId:       randomBytes(16).toString("hex"),
          callType:     "audio-video",
          callerId:     callerId,
          userMac:      userMac,
          sessionId:    fakeCallInfo.session3,
          apiKey:       fakeCallInfo.apiKey,
          calleeToken:  fakeCallInfo.token2,
          wsCallerToken: "caller",
          wsCalleeToken: "callee",
          callState:    constants.CALL_STATES.TERMINATED,
          timestamp:    now - 1
        }
      ],
      call = calls[0],
      urls = [
        {
          timestamp:  now,
          expires: now + callUrls.timeout
        },
        {
          timestamp:  now + 1,
          expires: now + callUrls.timeout
        },
        {
          timestamp:  now + 2,
          expires: now + callUrls.timeout
        }
      ],
    urlData = urls[0],
    callToken = generateToken(callUrls.tokenSize),
    roomToken = generateToken(conf.get("rooms").tokenSize),
    roomData = {
      sessionId: fakeCallInfo.session1,
      apiKey: fakeCallInfo.apiKey,
      roomName: "UX Discussion",
      roomOwner: "Alexis",
      maxSize: 3,
      expiresIn: 60 * 24,
      expiresAt: now + 60 * 24,
      updateTime: now,
      creationTime: now
    },
    roomParticipantData = {
      id: "azert",
      userIdHmac: userMac,
      clientMaxSize: 5,
      displayName: "Alexis",
      account: "abc"
    };

    var roomParticipantData2 = JSON.parse(JSON.stringify(roomParticipantData));
    roomParticipantData2.id = "qsdf";
    roomParticipantData2.displayName = "Alexis mobile";

    describe(name, function() {
      var sandbox;

      beforeEach(function() {
        storage = createStorage({
          tokenDuration: conf.get('tokBox').tokenDuration,
          hawkSessionDuration: conf.get('hawkSessionDuration'),
          callDuration: conf.get('callDuration'),
          maxSimplePushUrls: conf.get('maxSimplePushUrls')
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
          storage.revokeURLToken(uuid,
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
          storage.addUserSimplePushURLs(userMac, "1234", {
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
          storage.addUserSimplePushURLs(userMac, "1234", {
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
          storage.addUserSimplePushURLs(userMac, "1234", {
            calls: simplePushURL,
            rooms: simplePushURL2
          }, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURLs(userMac, "4567", {
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
          storage.addUserSimplePushURLs(userMac, "1234", {calls: simplePushURL}, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURLs(userMac, "4567", {calls: simplePushURL2},
              function(err) {
                if (err) throw err;
                storage.removeSimplePushURLs(userMac, "4567",
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
          storage.addUserSimplePushURLs(userMac, "1234", {calls: simplePushURL}, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURLs(userMac, "4567", {calls: simplePushURL2},
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
                  .eql("urlData should have a timestamp property.");
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
                  expect(data).to.eql({
                    callerId: "natim@moz",
                    issuer: "alexis@moz",
                    expires: urlData.expires,
                    timestamp: urlData.timestamp,
                    userMac: userMac
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
              expect(result.timestamp).to.gte(urlData.timestamp);
              delete result.timestamp;
              var data = JSON.parse(JSON.stringify(urlData));
              data.userMac = userMac;
              delete data.timestamp;
              expect(result).to.eql(data);
              done();
            });
          });
        });

        it("should return null if the call-url doesn't exist", function(done) {
          storage.getCallUrlData("does-not-exist", function(err, call) {
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
          if (storage.persistentOnly) {
            done();
            return;
          }
          var callData = JSON.parse(JSON.stringify(call));
          storage.addUserCall(userMac, callData, function(err) {
            if (err) throw err;
            storage.getUserCalls(userMac, function(err, results) {
              if (err) throw err;
              expect(results).to.have.length(1);
              var result = results[0];
              expect(result.timestamp).to.gte(callData.timestamp);
              delete result.timestamp;
              delete callData.timestamp;
              expect(results).to.eql([callData]);
              storage.deleteCall(callData.callId, function(err) {
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
          if (storage.persistentOnly) {
            done();
            return;
          }
          storage.addUserCall(userMac, calls[0], function(err) {
            if (err) throw err;
            storage.addUserCall(userMac, calls[1], function(err) {
              if (err) throw err;
              storage.addUserCall(userMac, calls[2], function(err) {
                if (err) throw err;
                storage.getUserCalls(userMac, function(err, results) {
                  if (err) throw err;
                  expect(results).to.have.length(3);
                  expect(results.map(function(call) {
                    expect(call.timestamp).to.gte(calls[0].timestamp);
                    delete call.timestamp;
                    return call;
                  }).sort(function(a, b) {
                    if (a.timestamp === b.timestamp) {
                      return a.callId > b.callId;
                    } else {
                      return a.timestamp - b.timestamp;
                    }
                  })).to.eql(calls.map(function(call, key) {
                    var data = JSON.parse(JSON.stringify(call));
                    delete data.timestamp;
                    if (key === 2) {
                      data.callState = constants.CALL_STATES.TERMINATED;
                    } else {
                      data.callState = constants.CALL_STATES.INIT;
                    }
                    return data;
                  }).sort(function(a, b) {
                    if (a.timestamp === b.timestamp) {
                      return a.callId > b.callId;
                    } else {
                      return a.timestamp - b.timestamp;
                    }
                  }));
                  done();
                });
              });
            });
          });
        });

        it("should return an empty list if no calls", function(done) {
          if (storage.persistentOnly) {
            done();
            return;
          }
          storage.getUserCalls(userMac, function(err, results) {
            expect(results).to.eql([]);
            done(err);
          });
        });
      });

      describe("#getCall", function() {
        it("should be able to list a call by its id", function(done) {
          if (storage.persistentOnly) {
            done();
            return;
          }
          storage.addUserCall(userMac, call, function(err) {
            if (err) throw err;
            storage.getCall(call.callId, function(err, result) {
              if (err) throw err;
              expect(result.timestamp).to.gte(call.timestamp);
              delete result.timestamp;
              var data = JSON.parse(JSON.stringify(call));
              delete data.timestamp;
              expect(result).to.eql(data);
              done();
            });
          });
        });

        it("should return null if the call doesn't exist", function(done) {
          if (storage.persistentOnly) {
            done();
            return;
          }
          storage.getCall("does-not-exist", function(err, call) {
            if (err) throw err;
            expect(call).to.eql(null);
            done();
          });
        });
      });

      describe("#deleteCall", function() {
        it("should delete an existing call", function(done) {
          if (storage.persistentOnly) {
            done();
            return;
          }
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
          if (storage.persistentOnly) {
            done();
            return;
          }
          storage.deleteCall("does-not-exist", function(err, result) {
            if (err) throw err;
            expect(result).to.eql(false);
            done();
          });
        });
      });

      describe("#deleteUserCalls", function() {
        it("should delete all calls of an user", function(done) {
          if (storage.persistentOnly) {
            done();
            return;
          }
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
          if (storage.persistentOnly) {
            done();
            return;
          }
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
          storage.setHawkSession("tokenid", "authKey", function(err) {
            if (err) throw err;
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

        it("should be cleaned by #deleteHawkSession", function(done) {
          storage.setHawkSession("tokenid", "authKey", function(err) {
            if (err) throw err;
            storage.setHawkUser("userhash", "tokenId", function(err) {
              if (err) throw err;
              storage.deleteHawkSession("tokenId", function(err) {
                if (err) throw err;
                storage.getHawkUser("userhash", function(err, result) {
                  if (err) throw err;
                  expect(result).to.eql(null);
                  done();
                });
              });
            });
          });
        });
      });

      describe("#setHawkUserId, #getHawkUserId", function() {
        it("should store and retrieve an user hawk session", function(done) {
          storage.setHawkSession("tokenid", "authKey", function(err) {
            if (err) throw err;
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

        it("should be cleaned by #deleteHawkSession", function(done) {
          storage.setHawkSession("tokenid", "authKey", function(err) {
            if (err) throw err;
            storage.setHawkUserId("tokenId", "userId", function(err) {
              if (err) throw err;
              storage.deleteHawkSession("tokenId", function(err) {
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
      });

      describe("#setCallState", function() {
        it("should set the call state", function(done) {
          if (storage.persistentOnly) {
            done();
            return;
          }
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
            if (storage.persistentOnly) {
              done();
              return;
            }
            storage.setCallState(
              "12345",
              constants.CALL_STATES.TERMINATED + ":unauthorized",
              function(err) {
                expect(err).to.not.eql(null);
                expect(err.message).match(/should be one of/);
                done();
              });
          });
      });

      describe("#getCallState", function() {
        it("should return null when no call state is set", function(done) {
          if (storage.persistentOnly) {
            done();
            return;
          }
          storage.getCallState("12345", function(err, state) {
            if (err) throw err;
            expect(state).to.eql(null);
            done();
          });
        });
      });

      describe("#setCallTerminationReason", function() {
        it("should set the call termination reason", function(done) {
          if (storage.persistentOnly) {
            done();
            return;
          }
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
          if (storage.persistentOnly) {
            done();
            return;
          }
          storage.getCallTerminationReason("12345", function(err, reason) {
            if (err) throw err;
            expect(reason).to.eql(null);
            done();
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
              roomData.ownerMac = userMac;
              expect(storedRoomData).to.eql(roomData);
              done();
            });
          });
        });

        it("should require an expiresAt property for the roomData",
          function(done) {
            var invalidData = JSON.parse(JSON.stringify(roomData));
            delete invalidData.expiresAt;
            storage.setUserRoomData(userMac, roomToken, invalidData,
              function(err) {
                expect(err.message)
                  .eql("roomData should have an expiresAt property.");
                done();
              });
          });
      });

      describe("#deleteRoomData", function() {
        it("should remove the room from the store", function(done) {
          storage.setUserRoomData(userMac, roomToken, roomData, function(err) {
            if (err) throw err;
            storage.deleteRoomData(roomToken, function(err) {
              if (err) throw err;
              storage.getRoomData(roomToken, function(err, storedRoomData) {
                if (err) throw err;
                expect(storedRoomData).to.eql(null);
                storage.getRoomParticipants(roomToken, function(err, results) {
                  if (err) throw err;
                  expect(results).to.eql([]);
                  done();
                });
              });
            });
          });
        });
      });

      describe("#deleteRoomParticipants", function() {
        it("should remove all the room participants", function(done) {
          storage.setUserRoomData(userMac, roomToken, roomData, function(err) {
            if (err) throw err;
            storage.addRoomParticipant(roomToken, "1234", roomParticipantData, 30,
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
      });

      describe("#addRoomParticipant", function() {
        it("should add a participant to the room", function(done) {
          storage.setUserRoomData(userMac, roomToken, roomData, function(err) {
            if (err) throw err;
            storage.addRoomParticipant(roomToken, "1234", roomParticipantData, ttl,
              function(err) {
                if (err) throw err;
                storage.addRoomParticipant(roomToken, "4567", roomParticipantData2, ttl,
                  function(err) {
                    if (err) throw err;
                    storage.getRoomParticipants(roomToken, function(err, results) {
                      if (err) throw err;
                      roomParticipantData.hawkIdHmac = "1234";
                      roomParticipantData2.hawkIdHmac = "4567";
                      expect(results).to.deep.include.members([roomParticipantData]);
                      expect(results).to.deep.include.members([roomParticipantData2]);
                      done();
                    });
                  });
              });
          });
        });
      });

      describe("#touchRoomParticipant", function() {
        it("should change the expiracy", function(done) {
          storage.setUserRoomData(userMac, roomToken, roomData, function(err) {
            if (err) throw err;
            storage.addRoomParticipant(roomToken, "1234", roomParticipantData, 30,
              function(err) {
                if (err) throw err;
                storage.touchRoomParticipant(roomToken, "1234", 0.01, function(err, success) {
                  if (err) throw err;
                  expect(success).to.eql(true);
                  setTimeout(function() {
                    storage.touchRoomParticipant(roomToken, "1234", 1, function(err, success) {
                      if (err) return done(err);
                      expect(success).to.eql(false);
                      storage.getRoomParticipants(roomToken, function(err, results) {
                        if (err) throw err;
                        expect(results).to.length(0);
                        done();
                      });
                    });
                  }, 15);
                });
              });
          });
        });
      });

      describe("#deleteRoomParticipant", function() {
        it("should remove a participant to the room", function(done) {
          storage.setUserRoomData(userMac, roomToken, roomData, function(err) {
            if (err) throw err;
            storage.addRoomParticipant(roomToken, "1234", roomParticipantData, ttl,
              function(err) {
                if (err) throw err;
                storage.addRoomParticipant(roomToken, "4567", roomParticipantData2, ttl,
                  function(err) {
                    if (err) throw err;
                    storage.deleteRoomParticipant(roomToken, "1234", function(err) {
                      if (err) throw err;
                      storage.getRoomParticipants(roomToken, function(err, results) {
                        if (err) throw err;
                        roomParticipantData.hawkIdHmac = "1234";
                        roomParticipantData2.hawkIdHmac = "4567";
                        expect(results).to.length(1);
                        expect(results[0]).to.eql(roomParticipantData2);
                        done();
                      });
                    });
                  });
              });
          });
        });
      });
    });
  }

  /* Test all the storages implementation. */
  testStorage("Redis", function createRedisStorage(options) {
    return getStorage({engine: "redis", settings: {"db": 5}}, options);
  });

  testStorage("MySQL", function createMySQLStorage(options) {
    return getStorage({engine: "mysql", settings: {
      "host": "localhost",
      "user": "travis",
      "password": "",
      "database": "looptest"}}, options);
  });

  testStorage("Proxy", function createProxyStorage(options) {
    return getStorage({
      "engine": "proxy",
      "settings": {
        "persistentStorage": {
          "engine": "mysql",
          "settings": {
            "host": "localhost",
            "user": "travis",
            "password": "",
            "database": "looptest"
          }
        },
        "volatileStorage": {
          "engine": "redis",
          "settings": {
            "db": 5
          }
        }
      }}, options);
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
      sandbox.stub(storage._client, "set",
        function(key, value, cb){
          cb("Error: Redis is read-only");
        });
      storage.ping(function(connected) {
        expect(connected).to.be.false;
        done();
      });
    });

    it("should handle storage errors correctly.", function(done) {
      sandbox.stub(storage._client, "smembers",
        function(key, cb){
          cb("error");
        });

      storage.getUserCallUrls(userMac, function(err, results) {
        expect(err).to.eql("error");
        expect(typeof results).to.eql("undefined");
        done();
      });
    });
  });
});
