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

  describe("with two clients", function() {
    var client2;

    beforeEach(function(done) {
      // Create the websocket second client.
      client2 = new ws("ws://localhost:" + server.address().port);
      client2.on('open', function() { done(); });
    });
  
    afterEach(function(done) {
      client2.on('close', function() { done(); });
      client2.close();
    });

    it('should broadcast call state to other interested parties',
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
              auth: tokenWrapper.token,
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
  });
});
