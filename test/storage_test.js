/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var expect = require("chai").expect;
var crypto = require("crypto");

var getStorage = require("../loop/storage");
var conf = require("../loop").conf;
var hmac = require("../loop").hmac;

var uuid = "1234";
var user = "alexis@notmyidea.com";
var userMac = hmac(user, conf.get("userMacSecret"));
var callerId = 'natim@mozilla.com';
var simplePushURL = "https://push.mozilla.com/test";
var fakeCallInfo = conf.get("fakeCallInfo");


describe("constructed Storage", function() {
  function testStorage(name, createStorage) {
    var storage;

    describe(name, function() {
      beforeEach(function() {
        storage = createStorage({
          tokenDuration: conf.get('tokBox').tokenDuration
        });
      });
  
      afterEach(function(done) {
        storage.drop(function(err) {
          storage = undefined;
          done(err);
        });
      });

      describe("urlsRevocationStore", function() {
        var a_second = 1 / 3600;  // A second in hour

        it("should store the URLToken so we can see it has been revoked",
          function(done) {
            storage.revokeURLToken({uuid: uuid, expires: a_second},
              function(err) {
                storage.isURLRevoked(uuid, function(err, value){
                  expect(value).to.equal(true);
                  done(err);
                });
              });
          });

        it("should not store expired token", function(done) {
            storage.revokeURLToken({uuid: uuid, expires: a_second / 100},
              function(err) {
                setTimeout(function() {
                  storage.isURLRevoked(uuid, function(err, value) {
                    expect(value).to.equal(false);
                    done(err);
                  });
                }, 20);
              });
          });
      });

      describe("urlsStore", function() {
        it("should be able to retrieve a simplePush URL per user",
          function(done) {
            storage.addUserSimplePushURL(userMac, simplePushURL, function() {
              storage.getUserSimplePushURLs(userMac, function(err, urls) {
                expect(urls).to.have.length(1);
                expect(urls).to.eql([simplePushURL]);

                /* A new URL should override the previous one */
                storage.addUserSimplePushURL(userMac, simplePushURL+'2',
                  function() {
                    storage.getUserSimplePushURLs(userMac, function(err, urls) {
                      expect(urls).to.have.length(1);
                      expect(urls).to.eql([simplePushURL+'2']);
                      done(err);
                    });
                  });
              });
            });
          });
      });
  
      describe("callsStore", function() {
        var calls = [
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
        ];

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

        it("should be able to manage calls.", function(done) {
          var call = calls[0];
          storage.addUserCall(userMac, call, function() {
            storage.getCall(call.callId, function(err, result) {
              expect(result).to.eql(call);

              storage.deleteCall(call.callId, function() {
                storage.getCall(call.callId, function(err, result) {
                  expect(result).to.equal(null);
                  done(err);
                });
              });
            });
          });
        });
      });  
    });
  }

  testStorage("RedisStore", function createRedisStorage(options) {
    return getStorage({engine: "redis", settings: {"db": 5}}, options);
  });

  testStorage("MongoDBStore", function createMongoDBStorage(options) {
    return getStorage({
      engine: "mongodb",
      settings: {
        connectionString: "mongodb://127.0.0.1:27017/loop_test"
      }
    }, options);
  });

  testStorage("MemoryStore", function createMemoryStorage(options) {
    return getStorage({engine: "memory"}, options);
  });
});