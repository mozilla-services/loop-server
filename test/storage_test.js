/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var expect = require("chai").expect;
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


describe("Storage", function() {
  function testStorage(name, createStorage) {
    var storage,
        a_second = 1 / 3600,  // A second in hours.
        calls = [
        {
          callId:       randomBytes(16).toString("hex"),
          callerId:     callerId,
          userMac:      userMac,
          sessionId:    fakeCallInfo.session1,
          calleeToken:  fakeCallInfo.token1,
          callState:    constants.CALL_STATES.INIT,
          timestamp:    parseInt(Date.now() / 1000, 10) - 3
        },
        {
          callId:       randomBytes(16).toString("hex"),
          callerId:     callerId,
          userMac:      userMac,
          sessionId:    fakeCallInfo.session2,
          calleeToken:  fakeCallInfo.token2,
          callState:    constants.CALL_STATES.INIT,
          timestamp:    parseInt(Date.now() / 1000, 10) - 2
        },
        {
          callId:       randomBytes(16).toString("hex"),
          callerId:     callerId,
          userMac:      userMac,
          sessionId:    fakeCallInfo.session3,
          calleeToken:  fakeCallInfo.token2,
          callState:    constants.CALL_STATES.TERMINATED,
          timestamp:    parseInt(Date.now() / 1000, 10) - 1
        }
      ],
      call = calls[0],
      urls = [
        {
          timestamp:  parseInt(Date.now() / 1000, 10),
          expires: parseInt(Date.now() / 1000, 10) + conf.get("callUrlTimeout")
        },
        {
          timestamp:  parseInt(Date.now() / 1000, 10) + 1,
          expires: parseInt(Date.now() / 1000, 10) + conf.get("callUrlTimeout")
        },
        {
          timestamp:  parseInt(Date.now() / 1000, 10) + 2,
          expires: parseInt(Date.now() / 1000, 10) + conf.get("callUrlTimeout")
        }
      ],
    urlData = urls[0],
    token = generateToken(conf.get("callUrlTokenSize"));

    describe(name, function() {
      beforeEach(function() {
        storage = createStorage({
          tokenDuration: conf.get('tokBox').tokenDuration,
          hawkSessionDuration: conf.get('hawkSessionDuration'),
          callDuration: conf.get('callDuration'),
          maxSimplePushUrls: conf.get('maxSimplePushUrls')
        });
      });

      afterEach(function(done) {
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

      describe("#removeSimplePushURL", function() {
        it("should delete an existing simple push URL", function(done) {
          storage.addUserSimplePushURLs(userMac, "1234", {calls: simplePushURL}, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURLs(userMac, "4567", {calls: simplePushURL2},
              function(err) {
                if (err) throw err;
                storage.removeSimplePushURL(userMac, "4567",
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
          storage.addUserCallUrlData(userMac, token, urlData, function(err) {
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
            storage.addUserCallUrlData(userMac, token, invalidData,
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
            storage.updateUserCallUrlData(userMac, token, urlData,
            function(err) {
              expect(err.notFound).to.eql(true);
              done();
            });
          });

        it("should update an existing call", function(done) {
          storage.addUserCallUrlData(userMac, token, urlData, function(err) {
            if (err) throw err;
            var updatedData = JSON.parse(JSON.stringify(urlData));
            updatedData.callerId = "natim@moz";
            updatedData.issuer = "alexis@moz";
            storage.updateUserCallUrlData(userMac, token, updatedData,
              function(err) {
                expect(err).to.eql(null);
                storage.getCallUrlData(token, function(err, data) {
                  if (err) throw err;
                  expect(data).eql({
                    callerId: "natim@moz",
                    issuer: "alexis@moz",
                    expires: urlData.expires,
                    timestamp: urlData.timestamp
                  });
                  done();
                });
              });
          });
        });
      });

      describe("#getUserCallUrls", function() {
        var sandbox;

        beforeEach(function() {
          sandbox = sinon.sandbox.create();
        });

        afterEach(function() {
          sandbox.restore();
        });

        it("should keep a list of the user urls", function(done) {
          var token1 = generateToken(conf.get("callUrlTokenSize"));
          storage.addUserCallUrlData(
            userMac,
            token1,
            urls[0],
            function() {
              storage.addUserCallUrlData(
                userMac,
                generateToken(conf.get("callUrlTokenSize")),
                urls[1],
                function() {
                  storage.addUserCallUrlData(
                    userMac,
                    generateToken(conf.get("callUrlTokenSize")),
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

      describe("#getCallUrlData", function() {
        it("should be able to list a call-url by its id", function(done) {
          storage.addUserCallUrlData(userMac, token, urlData, function(err) {
            if (err) {
              throw err;
            }
            storage.getCallUrlData(token, function(err, result) {
              if (err) {
                throw err;
              }
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
            generateToken(conf.get("callUrlTokenSize")),
            urls[0],
            function() {
              storage.addUserCallUrlData(
                userMac,
                generateToken(conf.get("callUrlTokenSize")),
                urls[1],
                function() {
                  storage.addUserCallUrlData(
                    userMac,
                    generateToken(conf.get("callUrlTokenSize")),
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
            if (err) {
              throw err;
            }
            storage.getUserCalls(userMac, function(err, results) {
              if (err) {
                throw err;
              }
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
        var sandbox;

        beforeEach(function() {
          sandbox = sinon.sandbox.create();
        });

        afterEach(function() {
          sandbox.restore();
        });

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

        it("should handle storage errors correctly.", function(done) {
          sandbox.stub(storage._client, "smembers",
            function(key, cb){
              cb("error");
            });

          storage.getUserCalls(userMac, function(err, results) {
            expect(err).to.eql("error");
            expect(typeof results).to.eql("undefined");
            done();
          });
        });
      });

      describe("#getCall", function() {
        it("should be able to list a call by its id", function(done) {
          storage.addUserCall(userMac, call, function(err) {
            if (err) {
              throw err;
            }
            storage.getCall(call.callId, function(err, result) {
              if (err) {
                throw err;
              }
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
              expect(result).to.eql(true);
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
            if (err) {
              throw err;
            }
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
            if (err) {
              throw err;
            }
            storage.deleteHawkSession("id", function(err) {
              if (err) {
                throw err;
              }
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
            if (err) {
              throw err;
            }
            storage.getHawkUser("tokenid", function(err, result) {
              if (err) {
                throw err;
              }
              expect(result).to.eql("userhash");
              done();
            });
          });
        });
      });

      describe("#setHawkUserId, #getHawkUserId", function() {
        it("should store and retrieve an user hawk session", function(done) {
          storage.setHawkUserId("tokenId", "userId", function(err) {
            if (err) {
              throw err;
            }
            storage.getHawkUserId("tokenId", function(err, result) {
              if (err) {
                throw err;
              }
              expect(result).to.eql("userId");
              done();
            });
          });
        });
      });

      describe("#deleteHawkUserId", function() {
        it("should delete an existing user hawk session", function(done) {
          storage.setHawkUserId("tokenId", "userId", function(err) {
            if (err) {
              throw err;
            }
            storage.deleteHawkUserId("tokenId", function(err) {
              if (err) {
                throw err;
              }
              storage.getHawkUserId("tokenId", function(err, result) {
                if (err) {
                  throw err;
                }
                expect(result).to.eql(null);
                done();
              });
            });
          });
        });
      });

      describe("#setCallState", function() {
        it("should set the call state", function(done) {
          storage.setCallState("12345", constants.CALL_STATES.INIT, 10,
            function(err) {
              if (err) throw err;
              storage.getCallState("12345", function(err, state) {
                if (err) throw err;
                expect(state).to.eql(constants.CALL_STATES.INIT);
                done();
              });
            });
        });

        it("should check the states are valid before storing them",
          function(done) {
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
          storage.getCallState("12345", function(err, state) {
            if (err) throw err;
            expect(state).to.eql(null);
            done();
          });
        });
      });

      describe("#ping", function() {
        it("should return true if we are connected", function(done) {
          storage.ping(function(connected) {
            expect(connected).to.eql(true);
            done();
          });
        });
      });
    });
  }

  // Test all the storages implementation.
  testStorage("Redis", function createRedisStorage(options) {
    return getStorage({engine: "redis", settings: {"db": 5}}, options);
  });
});
