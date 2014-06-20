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
    client.on('close', function() { done(); });
    client.close();
  });

  it('should listen on the same port the app does');

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

  it('should accept callers authenticating with the token url', function(done) {
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
          authType: "Token",
          auth: tokenWrapper.token,
          callId: callId
        }));
      });
    });
  });

  it('should return the state of the call', function(done) {
    var callId = crypto.randomBytes(16).toString('hex');

    var messageCounter = 0;

    storage.addUserCall(hawkCredentials.id, {
      'callerId': 'Remy',
      'callId': callId,
      'userMac': hawkCredentials.id,
      'sessionId': '1234',
      'calleeToken': '1234',
      'timestamp': Date.now()
    }, function(err) {
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

  describe.only("with two clients", function() {
    var client2, token, callId, messageCounter;

    beforeEach(function(done) {
      messageCounter = 0;
      callId = crypto.randomBytes(16).toString('hex');
      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });
      var tokenWrapper = tokenManager.encode({
        uuid: '1234',
        user: hawkCredentials.id,
        callerId: 'Alexis'
      });
      token = tokenWrapper.token;

      // Create the websocket second client.
      client2 = new ws("ws://localhost:" + server.address().port);
      client2.on('open', function() {
        storage.addUserCall(hawkCredentials.id, {
          'callerId': 'Remy',
          'callId': callId,
          'userMac': hawkCredentials.id,
          'sessionId': '1234',
          'calleeToken': '1234',
          'timestamp': Date.now()
        }, function(err) {
          if (err) throw err;
          storage.setCallState(callId, "init", function(err) {
            if (err) throw err;
            done();
          });
        });
      });
    });
  
    afterEach(function(done) {
      client2.on('close', function() { done(); });
      client2.close();
    });

    it('should broadcast alerting state to other interested parties',
      function(done) {
        client2.on('error', function() {
          throw new Error('Error: ' + data);
        });

        client2.on('message', function(data) {
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
    
        client2.send(JSON.stringify({
          messageType: 'hello',
          authType: "Token",
          auth: token,
          callId: callId
        }));
    
        client.send(JSON.stringify({
          messageType: 'hello',
          authType: "Hawk",
          auth: hawkCredentials.id,
          callId: callId
        }));
      });

    it('should broadcast action change state to other interested parties',
      function(done) {
        var messageCounter2 = 0;

        client2.on('message', function(data) {
          var message = JSON.parse(data);
          console.log(message);
          if (messageCounter2 === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
          } else if (messageCounter2 === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
          } else if (messageCounter2 === 2) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
            client2.send(JSON.stringify({
              messageType: 'action',
              event: 'media-up'
            }));
          } else if (messageCounter2 === 3) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("half-connected");
          } else if (messageCounter2 === 4) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connected");
          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("terminate");
            done();
          }
          messageCounter2++;
        });

        client.on('message', function(data) {
          var message = JSON.parse(data);
          console.log(message);
          if (messageCounter === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");            
          } else if (messageCounter === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
            client.send(JSON.stringify({
              messageType: 'action',
              event: 'accept'
            }));
          } else if (messageCounter === 2) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
            client.send(JSON.stringify({
              messageType: 'action',
              event: 'media-up'
            }));
          } else if (messageCounter === 3) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("half-connected");            
          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connected");            
          }

          messageCounter++;
        });
    
    
        client2.send(JSON.stringify({
          messageType: 'hello',
          authType: "Token",
          auth: token,
          callId: callId
        }));

        client.send(JSON.stringify({
          messageType: 'hello',
          authType: "Hawk",
          auth: hawkCredentials.id,
          callId: callId
        }));
      });
  });
});
