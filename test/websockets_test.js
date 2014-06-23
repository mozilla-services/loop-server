/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var sinon = require("sinon");
var crypto = require("crypto");

var ws = require('ws');

var Token = require("../loop/token").Token;
var tokenlib = require("../loop/tokenlib");

var loop = require("../loop");
var server = loop.server;
var storage = loop.storage;
var conf = loop.conf;

function createCall(callId, user, cb) {
  storage.addUserCall(user, {
    'callerId': 'Alexis',
    'callId': callId,
    'userMac': user,
    'sessionId': '1234',
    'calleeToken': '1234',
    'timestamp': Date.now()
  }, cb);
}

describe('websockets', function() {
  var client, hawkCredentials, userHmac, sandbox;

  beforeEach(function(done) {
    sandbox = sinon.sandbox.create();

    // Create the websocket client.
    client = new ws("ws://localhost:" + server.address().port);
    client.on('open', function() {
      // Generate Hawk credentials.
      var token = new Token();
      token.getCredentials(function(tokenId, authKey) {
        hawkCredentials = {
          id: tokenId,
          key: authKey,
          algorithm: "sha256"
        };
        userHmac = tokenId;
        storage.setHawkSession(tokenId, authKey, done);
      });
    });
  });

  afterEach(function(done) {
    sandbox.restore();
    if (client.isClosed === true) {
      done();
      return;
    }

    client.on('close', function() { done(); });
    client.close();
  });

  it('should reject bad authentication tokens', function(done) {
    var callId = crypto.randomBytes(16).toString('hex');
    createCall(callId, hawkCredentials.id, function(err) {
      if (err) throw err;
      client.on('message', function(data) {
        var error = JSON.parse(data);
        expect(error.messageType).eql('error');
        expect(error.reason).eql('bad authentication');
        done();
      });
      client.send(JSON.stringify({
        messageType: 'hello',
        authType: 'Hawk',
        auth: '1234',
        callId: callId
      }));
    });
  });

  it('should reject an invalid callId with a valid hawk session',
    function(done) {
      client.on('message', function(data) {
        var error = JSON.parse(data);
        expect(error.messageType).eql('error');
        expect(error.reason).eql('bad callId');
        done();
      });

      client.send(JSON.stringify({
        messageType: 'hello',
        authType: 'Hawk',
        auth: hawkCredentials.id,
        callId: '1234'
      }));
    });

  it('should accept callers authenticating with a valid token url',
    function(done) {
      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });
      var tokenWrapper = tokenManager.encode({
        uuid: '1234',
        user: hawkCredentials.id,
        callerId: 'Alexis'
      });
      var callId = crypto.randomBytes(16).toString('hex');

      // Create a call and set its state to "init".
      createCall(callId, hawkCredentials.id, function(err) {
        if (err) throw err;
        storage.setCallState(callId, "init", function(err) {
          if (err) throw err;
          client.on('message', function(data) {
            var message = JSON.parse(data);
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
            done();
          });

          client.send(JSON.stringify({
            messageType: 'hello',
            authType: "token",
            auth: tokenWrapper.token,
            callId: callId
          }));
        });
      });
    });

  it('should return the state of the call', function(done) {
    var callId = crypto.randomBytes(16).toString('hex');

    var messageCounter = 0;

    createCall(callId, hawkCredentials.id, function(err) {
      if (err) throw err;
      storage.setCallState(callId, "init", function(err) {
        if (err) throw err;
        client.on('message', function(data) {
          var message = JSON.parse(data);
          if (messageCounter === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
            messageCounter++;
          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
            done();
          }
        });

        client.send(JSON.stringify({
          messageType: 'hello',
          authType: "Hawk",
          auth: hawkCredentials.id,
          callId: callId
        }));
      });
    });
  });

  describe("with two clients", function() {
    var callee;
    var caller, token, callId, calleeMsgCount;

    beforeEach(function(done) {
      calleeMsgCount = 0;
      callId = crypto.randomBytes(16).toString('hex');

      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });

      token = tokenManager.encode({
        uuid: '1234',
        user: hawkCredentials.id,
        callerId: 'Alexis'
      }).token;

      // Name the existing ws client "callee" for readability.
      callee = client;

      // Create the second websocket callee.
      caller = new ws("ws://localhost:" + server.address().port);

      // The on("open") needs to be defined right after the callee creation,
      // otherwise the event might be lost.
      caller.on('open', function() {
        // Create a call and initialize its state to "init".
        createCall(callId, hawkCredentials.id, function(err) {
          if (err) throw err;
          storage.setCallState(callId, "init", function(err) {
            if (err) throw err;
            done();
          });
        });
      });
    });
  
    afterEach(function(done) {
      if (caller.isClosed === true) {
        done();
        return;
      }
      caller.on('close', function() { done(); });
      caller.close();
    });

    it('should broadcast alerting state to other interested parties',
      function(done) {
        caller.on('error', function(data) {
          throw new Error('Error: ' + data);
        });

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          // First message should be "hello/init".
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
          } else {
            // Second should be "progress/alerting".
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
            done();
          }
          calleeMsgCount++;
        });
    
        // Caller registers to the socket.
        caller.send(JSON.stringify({
          messageType: 'hello',
          authType: "Token",
          auth: token,
          callId: callId
        }));
    
        // Callee registers to the socket.
        callee.send(JSON.stringify({
          messageType: 'hello',
          authType: "Hawk",
          auth: hawkCredentials.id,
          callId: callId
        }));
      });

    it('should broadcast action change and handle race condition.',
      function(done) {
        var callerMsgCount = 0;

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (callerMsgCount === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");

          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");

          } else if (callerMsgCount === 2) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
            caller.send(JSON.stringify({
              messageType: 'action',
              event: 'media-up'
            }));

          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connected");
          }
          if (callerMsgCount === 4) {
            done();
          }
          callerMsgCount++;
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");            

          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
            callee.send(JSON.stringify({
              messageType: 'action',
              event: 'accept'
            }));

          } else if (calleeMsgCount === 2) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
            callee.send(JSON.stringify({
              messageType: 'action',
              event: 'media-up'
            }));

          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connected");            
          }
          calleeMsgCount++;
        });
    
    
        caller.send(JSON.stringify({
          messageType: 'hello',
          authType: "Token",
          auth: token,
          callId: callId
        }));

        callee.send(JSON.stringify({
          messageType: 'hello',
          authType: "Hawk",
          auth: hawkCredentials.id,
          callId: callId
        }));
      });

    it('should broadcast half-connected signal.',
      function(done) {
        var callerMsgCount = 0;

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (callerMsgCount === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");

          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");

          } else if (callerMsgCount === 2) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
            caller.send(JSON.stringify({
              messageType: 'action',
              event: 'media-up'
            }));

          } else if (callerMsgCount === 3) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("half-connected");
            callee.send(JSON.stringify({
              messageType: 'action',
              event: 'media-up'
            }));            

          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connected");
            done();
          }
          callerMsgCount++;
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");            
          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
            callee.send(JSON.stringify({
              messageType: 'action',
              event: 'accept'
            }));
          } else if (calleeMsgCount === 2) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
          } else if (calleeMsgCount === 3) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("half-connected");            
          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connected");
          }
          calleeMsgCount++;
        });
    
    
        caller.send(JSON.stringify({
          messageType: 'hello',
          authType: "Token",
          auth: token,
          callId: callId
        }));

        callee.send(JSON.stringify({
          messageType: 'hello',
          authType: "Hawk",
          auth: hawkCredentials.id,
          callId: callId
        }));
      });

    it("should close socket on progress/terminate message", function(done) {
      caller.on('close', function() {
        caller.isClosed = true;
        done();
      });

      caller.on('message', function(data) {
        var message = JSON.parse(data);
        if (message.messageType === "hello") {
          caller.send(JSON.stringify({
            messageType: 'action',
            event: 'terminate',
            reason: 'cancel'
          }));
        }
      });

      caller.send(JSON.stringify({
        messageType: 'hello',
        authType: "Token",
        auth: token,
        callId: callId
      }));
    });

    it("should close the socket on progress/connected message", function(done) {

    });
    it("should close the socket on storage error");
    it("should not accept a non alphanumeric reason on action/terminate");
    it("should proxy the reason on action/terminate");

    it("should broadcast progress/terminate if call was initiated more than X seconds ago");
    it("should not broadcast progress/terminate if callee subscribed in less than X seconds");

    it("should broadcast progress/terminate if call is ringing for more than X seconds");
    it("should not broadcast progress/terminate if call had been anwsered");

    it("should broadcast progress/terminate if media not up for both parties after X seconds");
    it("should not broadcast progress/terminate if media connected for both parties");
    it("should reject invalid transitions");
  });
});
