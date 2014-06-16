/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var expect = require("chai").expect;
var crypto = require("crypto");
var sinon = require("sinon");

var getStorage = require("../loop/storage");
var conf = require("../loop").conf;
var hmac = require("../loop").hmac;

var uuid = "1234";
var user = "alexis@notmyidea.com";
var userMac = hmac(user, conf.get("userMacSecret"));
var callerId = 'natim@mozilla.com';
var simplePushURL = "https://push.mozilla.com/test";
var fakeCallInfo = conf.get("fakeCallInfo");


describe("Storage", function() {
  function testStorage(name, createStorage) {
    var storage, 
        a_second = 1 / 3600,  // A second in hours.
        calls = [
        {
          callId:       crypto.randomBytes(16).toString("hex"),
          callerId:     callerId,
          userMac:      userMac,
          sessionId:    fakeCallInfo.session1,
          calleeToken:  fakeCallInfo.token1,
          timestamp:    0
        },
        {
          callId:       crypto.randomBytes(16).toString("hex"),
          callerId:     callerId,
          userMac:      userMac,
          sessionId:    fakeCallInfo.session2,
          calleeToken:  fakeCallInfo.token2,
          timestamp:    1
        },
        {
          callId:       crypto.randomBytes(16).toString("hex"),
          callerId:     callerId,
          userMac:      userMac,
          sessionId:    fakeCallInfo.session3,
          calleeToken:  fakeCallInfo.token2,
          timestamp:    2
        }
      ],
      call = calls[0];

    describe(name, function() {
      beforeEach(function() {
        storage = createStorage({
          tokenDuration: conf.get('tokBox').tokenDuration,
          hawkSessionDuration: conf.get('hawkSessionDuration')
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
              if (err)  {
                throw err;
              }
              storage.isURLRevoked(uuid, function(err, value){
                expect(value).to.equal(true);
                done(err);
              });
            });
        });
      });

      describe('isURLRevoked', function() {
        it("should not return an expired token", function(done) {
          storage.revokeURLToken({uuid: uuid, expires: a_second / 100},
            function(err) {
              setTimeout(function() {
                storage.isURLRevoked(uuid, function(err, value) {
                  if (err) {
                    throw err;
                  }
                  expect(value).to.equal(false);
                  done();
                });
              }, 20);
            });
        });

        it("should not return a non existing token", function(done) {
          storage.isURLRevoked("does-not-exist", function(err, value) {
            expect(value).to.equal(false);
            done(err);
          });
        });
      });

      describe("#addUserSimplePushURL", function() {
        it("should be able to add a user simple push URL", function(done) {
          storage.addUserSimplePushURL(userMac, simplePushURL, function(err) {
            if (err) {
              throw err;
            }
            storage.getUserSimplePushURLs(userMac, function(err, urls) {
              expect(urls).to.have.length(1);
              expect(urls).to.eql([simplePushURL]);
              done(err);
            });
          });
        });

        it("should overwrite existing simple push URLs", function(done) {
          storage.addUserSimplePushURL(userMac, simplePushURL, function(err) {
            storage.addUserSimplePushURL(userMac, simplePushURL + '2',
              function(err) {
                storage.getUserSimplePushURLs(userMac, function(err, urls) {
                  expect(urls).to.have.length(1);
                  expect(urls).to.eql([simplePushURL + '2']);
                  done(err);
                });
              });
          });
        });
      });

      describe("#getUserSimplePushURLs", function() {
        it("should return an empty list if nothing had been registered",
          function(done) {
            storage.getUserSimplePushURLs("does-not-exist",
              function(err, urls) {
                if (err) {
                  throw err;
                }
                expect(urls).to.eql([]);
                done();
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
              done();
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
          storage.addUserCall(userMac, calls[0], function() {
            storage.addUserCall(userMac, calls[1], function() {
              storage.addUserCall(userMac, calls[2], function() {
                storage.getUserCalls(userMac, function(err, results) {
                  expect(results).to.have.length(3);
                  expect(results).to.eql(calls);
                  done(err);
                });
              });
            });
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
            expect(call).to.eql(null);
            done();
          });
        });
      });

      describe("#deleteCall", function() {
        it("should delete an existing call", function(done) {
          storage.addUserCall(userMac, call, function(err) {
            storage.deleteCall(call.callId, function(err, result) {
              expect(result).to.eql(true);
              storage.getCall(call.callId, function(err, result) {
                expect(result).to.equal(null);
                done(err);
              });
            });
          });
        });

        it("should return an error if the call doesn't exist", function(done) {
          storage.deleteCall("does-not-exist", function(err, result) {
            expect(result).to.eql(false);
            done();
          });
        });
      });

      describe("#getHawkSession", function() {
        it("should return null if the hawk session doesn't exist",
          function(done) {
            storage.getHawkSession("does-not-exist", function(err, result) {
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
              expect(result).to.eql({
                key: "key",
                algorithm: "sha256"
              });
              done();
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
