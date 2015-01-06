/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var sinon = require("sinon");
var randomBytes = require("crypto").randomBytes;

var ws = require('ws');

var Token = require("express-hawkauth").Token;
var hmac = require("../loop/hmac");

var hekaLogger = require('../loop/logger').hekaLogger;
var constants = require("../loop/constants");
var loop = require("../loop");
var server = loop.server;
var storage = loop.storage;
var conf = loop.conf;

function createCall(callId, user, callback) {
  storage.addUserCall(user, {
    callerId: 'Alexis',
    callId: callId,
    userMac: user,
    sessionId: '1234',
    calleeToken: '1234',
    callState: constants.CALL_STATES.INIT,
    timestamp: Date.now(),
    wsCallerToken: "callerToken",
    wsCalleeToken: "calleeToken"
  }, callback);
}

describe('websockets', function() {
  var client, hawkCredentials, userHmac, sandbox;

  beforeEach(function(done) {
    this.timeout(5000);
    sandbox = sinon.sandbox.create();

    // Create the websocket client.
    client = new ws("ws://localhost:" +
      server.address().port +
      conf.get('progressURLEndpoint'));

    client.on('close', function() {
      client.isClosed = true;
    });

    client.on('open', function() {
      // Generate Hawk credentials.
      var token = new Token();
      token.getCredentials(function(tokenId, authKey) {
        hawkCredentials = {
          id: tokenId,
          key: authKey,
          algorithm: "sha256"
        };
        userHmac = hmac(tokenId, conf.get('hawkIdSecret'));
        storage.setHawkSession(userHmac, authKey, done);
      });
    });
  });

  afterEach(function(done) {
    sandbox.restore();
    if (!client.isClosed) {
      client.close();
    }
    done();
  });

  it('should echo back a message', function(done) {
    client.on('message', function(data) {
      var message = JSON.parse(data);
      expect(message.messageType).eql(constants.MESSAGE_TYPES.ECHO);
      expect(message.echo).eql('foo');
      done();
    });
    client.send(JSON.stringify({
      messageType: constants.MESSAGE_TYPES.ECHO,
      echo: 'foo'
    }));
  });

  it('should reject bad authentication tokens', function(done) {
    var callId = randomBytes(16).toString('hex');
    createCall(callId, hawkCredentials.id, function(err) {
      if (err) throw err;
      client.on('message', function(data) {
        var error = JSON.parse(data);
        expect(error.messageType).eql(constants.MESSAGE_TYPES.ERROR);
        expect(error.reason).eql(constants.ERROR_REASONS.BAD_AUTHENTICATION);
        done();
      });
      client.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: 'wrongCalleeToken',
        callId: callId
      }));
    });
  });

  it('should reject an invalid callId with a valid hawk session',
    function(done) {
      client.on('message', function(data) {
        var error = JSON.parse(data);
        expect(error.messageType).eql(constants.MESSAGE_TYPES.ERROR);
        expect(error.reason).eql(constants.ERROR_REASONS.BAD_CALLID);
        done();
      });

      client.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: "calleeToken",
        callId: '1234'
      }));
    });

  it('should accept caller authenticating with a valid token url',
    function(done) {
      var callId = randomBytes(16).toString('hex');

      // Create a call and set its state to "init".
      createCall(callId, hawkCredentials.id, function(err) {
        if (err) throw err;
        storage.setCallState(callId, constants.CALL_STATES.INIT, function(err) {
          if (err) throw err;
          client.on('message', function(data) {
            var message = JSON.parse(data);
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
            done();
          });

          client.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.HELLO,
            auth: "callerToken",
            callId: callId
          }));
        });
      });
    });

  it('should return the state of the call', function(done) {
    var callId = randomBytes(16).toString('hex');

    createCall(callId, hawkCredentials.id, function(err) {
      if (err) throw err;
      storage.setCallState(callId, constants.CALL_STATES.INIT, function(err) {
        if (err) throw err;
        client.on('message', function(data) {
          var message = JSON.parse(data);
          expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
          expect(message.state).eql(constants.CALL_STATES.INIT);
          done();
        });

        client.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });
    });
  });

  describe("with two clients", function() {
    var callee;
    var caller, callId, calleeMsgCount;

    beforeEach(function(done) {
      this.timeout(5000);
      calleeMsgCount = 0;
      callId = randomBytes(16).toString('hex');

      // Name the existing ws client "callee" for readability.
      callee = client;

      // Create the second websocket callee.
      caller = new ws("ws://localhost:" +
        server.address().port +
        conf.get('progressURLEndpoint'));

      // The on("open") needs to be defined right after the callee creation,
      // otherwise the event might be lost.
      caller.on('close', function() { caller.isClosed = true; });

      caller.on('open', function() {
        // Create a call and initialize its state to "init".
        createCall(callId, hawkCredentials.id, function(err) {
          if (err) throw err;
          storage.setCallState(callId, constants.CALL_STATES.INIT,
            conf.get("timers").supervisoryDuration, function(err) {
              if (err) throw err;
              done();
            });
        });
      });
    });

    afterEach(function(done) {
      if (! caller.isClosed) {
        caller.close();
      }
      done();
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
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
          } else {
            // Second should be "progress/alerting".
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
            done();
          }
          calleeMsgCount++;
        });

        // Caller registers to the socket.
        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));

        // Callee registers to the socket.
        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

    describe('With mocked heka logger', function() {
      var logs = [];
      var oldMetrics = conf.get("hekaMetrics");

      beforeEach(function() {
        oldMetrics.activated = true;
        conf.set("hekaMetrics", oldMetrics);
        sandbox.stub(hekaLogger, 'info', function(op, log) {
          log.op = op;
          logs.push(log);
        });
      });

      afterEach(function() {
        oldMetrics.activated = false;
        conf.set("hekaMetrics", oldMetrics);
      });

      it('should log the termination and reason in heka', function(done) {
        caller.on('error', function(data) {
          throw new Error('Error: ' + data);
        });

        caller.on('message', function() {
          if (calleeMsgCount === 2) {
            // The heka logger should have been called with the reason.
            expect(logs).to.length.gte(1);
            var last = logs[logs.length - 1];
            expect(last.callId).to.not.eql(undefined);
            expect(last.op).to.eql('websocket.summary');
            expect(last.state).to.eql('terminated');
            expect(last.reason).to.eql('closed');
            logs.forEach(function(log) {
              ['messageType', 'callId', 'op', 'time'].forEach(function(property) {
                expect(log).to.have.property(property);
              });
              Object.keys(log).forEach(function(key) {
                expect(['messageType', 'callId', 'op', 'time', 'state', 'reason',
                        'auth', 'closeConnection']).to.include(key);
              });
            });
            done();
          }
          calleeMsgCount++;
        });

        callee.on('message', function() {
          // The callee websocket closed unexpectedly
          callee.isClosed = true;
          callee.close();
        });

        // Caller registers to the socket.
        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));

        // Callee registers to the socket.
        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

      it('should log only one termination reason in heka', function(done) {
        caller.on('error', function(data) {
          throw new Error('Error: ' + data);
        });

        caller.on('message', function() {
          if (calleeMsgCount >= 2) {
            // The heka logger should have been called with the reason.
            expect(logs).to.length.gte(1);
            var last = logs[logs.length - 1];
            expect(last.callId).to.not.eql(undefined);
            expect(last.op).to.eql('websocket.summary');
            expect(last.state).to.eql('terminated');
            expect(last.reason).to.eql('busy');
            logs.forEach(function(log) {
              ['messageType', 'callId', 'op', 'time'].forEach(function(property) {
                expect(log).to.have.property(property);
              });
              Object.keys(log).forEach(function(key) {
                expect(['messageType', 'callId', 'op', 'time', 'state', 'reason',
                        'auth', 'closeConnection', 'event']).to.include(key);
              });
            });
            done();
          }
          calleeMsgCount++;
        });

        callee.on('message', function() {
          // Send process terminate
          callee.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.ACTION,
            auth: "calleeToken",
            callId: callId,
            event: "terminate",
            reason: "busy"
          }));
        });

        // Caller registers to the socket.
        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));

        // Callee registers to the socket.
        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });
    });

    it('should broadcast progress terminated:closed to other interested parties',
      function(done) {
        caller.on('error', function(data) {
          throw new Error('Error: ' + data);
        });

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          // First message should be "hello/init".
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
          } else if (calleeMsgCount === 2) {
            // Third should be "progress/terminated/closed".
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.TERMINATED);
            expect(message.reason).eql(constants.MESSAGE_REASONS.CLOSED);
            done();
          }
          calleeMsgCount++;
        });

        callee.on('message', function() {
          // The callee websocket closed unexpectedly
          callee.isClosed = true;
          callee.close();
        });

        // Caller registers to the socket.
        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));

        // Callee registers to the socket.
        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

    it('should broadcast action change and handle race condition.',
      function(done) {
        var callerMsgCount = 0;

        caller.on('close', function() {
          caller.isClosed = true;
          if (callee.isClosed) {
            done();
          }
        });

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (callerMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);

          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);

          } else if (callerMsgCount === 2) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTING);
            caller.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.MEDIA_UP
            }));

          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTED);
          }
          callerMsgCount++;
        });

        callee.on('close', function() {
          callee.isClosed = true;
          if (caller.isClosed) {
            done();
          }
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);

          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
            callee.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.ACCEPT
            }));

          } else if (calleeMsgCount === 2) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTING);
            callee.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.MEDIA_UP
            }));

          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTED);
          }
          calleeMsgCount++;
        });


        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));

        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

    it('should broadcast half-connected signal.',
      function(done) {
        var callerMsgCount = 0;

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (callerMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);

          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);

          } else if (callerMsgCount === 2) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTING);
            caller.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.MEDIA_UP
            }));

          } else if (callerMsgCount === 3) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.HALF_CONNECTED);
            callee.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.MEDIA_UP
            }));

          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTED);
            caller.isClosed = true;
            if (callee.isClosed) done();
          }
          callerMsgCount++;
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
            callee.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.ACCEPT
            }));
          } else if (calleeMsgCount === 2) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTING);
          } else if (calleeMsgCount === 3) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.HALF_CONNECTED);
          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTED);
            callee.isClosed = true;
            if (caller.isClosed) done();
          }
          calleeMsgCount++;
        });


        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));

        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

    it("should close socket on progress/connected message", function(done) {
      callee.on('close', function() {
        callee.isClosed = true;
        if (caller.isClosed) {
          done();
        }
      });

      caller.on('close', function() {
        caller.isClosed = true;
        if (callee.isClosed) {
          done();
        }
      });

      caller.on('message', function(data) {
        var message = JSON.parse(data);
        if (message.state === constants.CALL_STATES.HALF_CONNECTED) {
          caller.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.ACTION,
            event: constants.MESSAGE_EVENTS.MEDIA_UP
          }));
        }
      });

      callee.on('message', function(data) {
        var message = JSON.parse(data);
        if (message.state === constants.CALL_STATES.ALERTING) {
          callee.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.ACTION,
            event: constants.MESSAGE_EVENTS.ACCEPT
          }));
        } else if (message.state === constants.CALL_STATES.CONNECTING) {
          callee.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.ACTION,
            event: constants.MESSAGE_EVENTS.MEDIA_UP
          }));
        }
      });

      caller.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: "callerToken",
        callId: callId
      }));

      callee.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: "calleeToken",
        callId: callId
      }));
    });

    it("should close the socket on progress/terminate message", function(done) {
      caller.on('close', function() {
        caller.isClosed = true;
        done();
      });

      caller.on('message', function(data) {
        var message = JSON.parse(data);
        if (message.messageType === constants.MESSAGE_TYPES.HELLO) {
          caller.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.ACTION,
            event: constants.MESSAGE_EVENTS.TERMINATE,
            reason: constants.MESSAGE_REASONS.CANCEL
          }));
        }
      });

      caller.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: "callerToken",
        callId: callId
      }));
    });

    it("should close the socket on storage error", function(done) {
      sandbox.stub(storage, "getCallState", function(callId, callback) {
        callback(new Error("Error with storage"));
      });

      caller.on('close', function() {
        caller.isClosed = true;
        done();
      });

      caller.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: "callerToken",
        callId: callId
      }));
    });

    it("should not accept a non-alphanumeric reason on action/terminate",
      function(done) {
        caller.on('close', function() {
          caller.isClosed = true;
          done();
        });

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (message.messageType === constants.MESSAGE_TYPES.HELLO) {
            caller.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.TERMINATE,
              reason: 't#i5-!s-the-@nd'
            }));
          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.ERROR);
            expect(message.reason)
              .eql(constants.ERROR_REASONS.BAD_REASON);
          }
        });

        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));
      });

    it("should proxy the reason on action/terminate", function(done) {
      caller.on('close', function() {
        caller.isClosed = true;
        done();
      });

      caller.on('message', function(data) {
        var message = JSON.parse(data);
        if (message.messageType === constants.MESSAGE_TYPES.HELLO) {
          caller.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.ACTION,
            event: constants.MESSAGE_EVENTS.TERMINATE,
            reason: constants.MESSAGE_REASONS.CANCEL
          }));
        } else {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
          expect(message.state).eql(constants.CALL_STATES.TERMINATED);
          expect(message.reason).eql(constants.MESSAGE_REASONS.CANCEL);
        }
      });

      caller.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: "callerToken",
        callId: callId
      }));
    });

    it("should reject invalid transitions", function(done) {
      caller.on('close', function() {
        caller.isClosed = true;
        done();
      });

      caller.on('message', function(data) {
        var message = JSON.parse(data);
        if (message.messageType === constants.MESSAGE_TYPES.HELLO) return;
        if (message.messageType === constants.MESSAGE_TYPES.PROGRESS) {
          caller.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.ACTION,
            event: constants.MESSAGE_EVENTS.MEDIA_UP
          }));
        } else {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.ERROR);
          expect(message.reason).eql(
            "No transition from alerting state with media-up event.");
        }
      });

      caller.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: "callerToken",
        callId: callId
      }));

      callee.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: "calleeToken",
        callId: callId
      }));
    });

    it("should close the connection if callee doesn't connect",
      function(done) {
        caller.on('close', function() {
          caller.isClosed = true;
          done();
        });

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (message.messageType === constants.MESSAGE_TYPES.PROGRESS) {
            expect(message.state).eql(constants.CALL_STATES.TERMINATED);
            expect(message.reason).eql(constants.MESSAGE_REASONS.TIMEOUT);
            storage.getCallState(callId, function(err, state) {
              if (err) throw err;
              expect(state).eql(constants.CALL_STATES.TERMINATED);
            });
          }
        });

        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));
      });

    it("should close the connection if caller doesn't connect",
      function(done) {
        callee.on('close', function() {
          callee.isClosed = true;
          done();
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (message.messageType === constants.MESSAGE_TYPES.PROGRESS) {
            expect(message.state).eql(constants.CALL_STATES.TERMINATED);
            expect(message.reason).eql(constants.MESSAGE_REASONS.TIMEOUT);
            storage.getCallState(callId, function(err, state) {
              if (err) throw err;
              expect(state).eql(constants.CALL_STATES.TERMINATED);
            });
          }
        });

        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

    it("should not broadcast progress/terminate if callee subscribed in " +
       "less than X seconds", function(done) {
        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (message.messageType === constants.MESSAGE_TYPES.HELLO) {
            // The callee connects!
            callee.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.HELLO,
              auth: "calleeToken",
              callId: callId
            }));
          } else if (message.messageType === constants.MESSAGE_TYPES.PROGRESS){
            expect(message.state).not.eql(constants.CALL_STATES.TERMINATED);
            done();
          }
        });
        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));
      });

    it("should not broadcast progress/terminate if caller subscribed in " +
       "less than X seconds", function(done) {
        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (message.messageType === constants.MESSAGE_TYPES.HELLO) {
            // The callee connects!
            caller.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.HELLO,
              auth: "callerToken",
              callId: callId
            }));
          } else if (message.messageType === constants.MESSAGE_TYPES.PROGRESS){
            expect(message.state).not.eql(constants.CALL_STATES.TERMINATED);
            done();
          }
        });
        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

    it("should close the connection if ringing for too long",
      function(done) {
        var callerMsgCount = 0;

        function stopTest() {
          if (caller.isClosed && callee.isClosed) {
            expect(callerMsgCount).to.eql(3);
            expect(calleeMsgCount).to.eql(3);
            done();
          }
        }

        callee.on('close', function() {
          callee.isClosed = true;
          stopTest();
        });

        caller.on('close', function() {
          caller.isClosed = true;
          stopTest();
        });

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (callerMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
          }
          callerMsgCount++;
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.TERMINATED);
            expect(message.reason).eql(constants.MESSAGE_REASONS.TIMEOUT);
            storage.getCallState(callId, function(err, state) {
              if (err) throw err;
              expect(state).eql(constants.CALL_STATES.TERMINATED);
            });
          }
          calleeMsgCount++;
        });

        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));

        // The callee connects!
        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

    it("should not close the connection if call had been anwsered",
      function(done) {
        var callerMsgCount = 0;

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (callerMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
          }
          callerMsgCount++;
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
            callee.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.ACCEPT
            }));
          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTING);
            done();
          }
          calleeMsgCount++;
        });

        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));

        // The callee connects!
        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

    it("should close the connection if media-up not send by anybody",
      function(done) {
        var callerMsgCount = 0;

        callee.on('close', function() {
          callee.isClosed = true;
          if (caller.isClosed) {
            done();
          }
        });

        caller.on('close', function() {
          caller.isClosed = true;
          if (callee.isClosed) {
            done();
          }
        });

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (callerMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
          } else if (callerMsgCount === 2) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTING);
          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.TERMINATED);
            expect(message.reason).eql(constants.MESSAGE_REASONS.TIMEOUT);
            storage.getCallState(callId, function(err, state) {
              if (err) throw err;
              expect(state).eql(constants.CALL_STATES.TERMINATED);
            });
          }
          callerMsgCount++;
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
            callee.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.ACCEPT
            }));
          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
          } else if (calleeMsgCount === 2) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTING);
          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.TERMINATED);
            expect(message.reason).eql(constants.MESSAGE_REASONS.TIMEOUT);
            storage.getCallState(callId, function(err, state) {
              if (err) throw err;
              expect(state).eql(constants.CALL_STATES.TERMINATED);
            });
          }
          calleeMsgCount++;
        });

        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));

        // The callee connects!
        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

    it("should close the connection if media-up sent by only one party",
      function(done) {
        var callerMsgCount = 0;

        callee.on('close', function() {
          callee.isClosed = true;
          if (caller.isClosed) {
            done();
          }
        });

        caller.on('close', function() {
          caller.isClosed = true;
          if (callee.isClosed) {
            done();
          }
        });

        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (callerMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
          } else if (callerMsgCount === 2) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTING);
            callee.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.MEDIA_UP
            }));
          } else if (callerMsgCount === 3) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.HALF_CONNECTED);
          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.TERMINATED);
            expect(message.reason).eql(constants.MESSAGE_REASONS.TIMEOUT);
            storage.getCallState(callId, function(err, state) {
              if (err) throw err;
              expect(state).eql(constants.CALL_STATES.TERMINATED);
            });
          }
          callerMsgCount++;
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
            expect(message.state).eql(constants.CALL_STATES.INIT);
            callee.send(JSON.stringify({
              messageType: constants.MESSAGE_TYPES.ACTION,
              event: constants.MESSAGE_EVENTS.ACCEPT
            }));
          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.ALERTING);
          } else if (calleeMsgCount === 2) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.CONNECTING);
          } else if (calleeMsgCount === 3) {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.HALF_CONNECTED);
          } else {
            expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
            expect(message.state).eql(constants.CALL_STATES.TERMINATED);
            expect(message.reason).eql(constants.MESSAGE_REASONS.TIMEOUT);
            storage.getCallState(callId, function(err, state) {
              if (err) throw err;
              expect(state).eql(constants.CALL_STATES.TERMINATED);
            });
          }
          calleeMsgCount++;
        });

        caller.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "callerToken",
          callId: callId
        }));

        // The callee connects!
        callee.send(JSON.stringify({
          messageType: constants.MESSAGE_TYPES.HELLO,
          auth: "calleeToken",
          callId: callId
        }));
      });

    it("should not close if both parties got connected", function(done) {
      var callerMsgCount = 0;

      callee.on('close', function() {
        callee.isClosed = true;
        if (caller.isClosed) {
          done();
        }
      });

      caller.on('close', function() {
        caller.isClosed = true;
        if (callee.isClosed) {
          done();
        }
      });

      caller.on('message', function(data) {
        var message = JSON.parse(data);
        if (callerMsgCount === 0) {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
          expect(message.state).eql(constants.CALL_STATES.INIT);
        } else if (callerMsgCount === 1) {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
          expect(message.state).eql(constants.CALL_STATES.ALERTING);
        } else if (callerMsgCount === 2) {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
          expect(message.state).eql(constants.CALL_STATES.CONNECTING);
          caller.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.ACTION,
            event: constants.MESSAGE_EVENTS.MEDIA_UP
          }));
        } else if (callerMsgCount === 3) {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
          expect(message.state).eql(constants.CALL_STATES.HALF_CONNECTED);
        } else {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
          expect(message.state).eql(constants.CALL_STATES.CONNECTED);
        }
        callerMsgCount++;
      });

      callee.on('message', function(data) {
        var message = JSON.parse(data);
        if (calleeMsgCount === 0) {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
          expect(message.state).eql(constants.CALL_STATES.INIT);
          callee.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.ACTION,
            event: constants.MESSAGE_EVENTS.ACCEPT
          }));
        } else if (calleeMsgCount === 1) {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
          expect(message.state).eql(constants.CALL_STATES.ALERTING);
        } else if (calleeMsgCount === 2) {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
          expect(message.state).eql(constants.CALL_STATES.CONNECTING);
        } else if (calleeMsgCount === 3) {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
          expect(message.state).eql(constants.CALL_STATES.HALF_CONNECTED);
          callee.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.ACTION,
            event: constants.MESSAGE_EVENTS.MEDIA_UP
          }));
        } else {
          expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
          expect(message.state).eql(constants.CALL_STATES.CONNECTED);
        }
        calleeMsgCount++;
      });

      caller.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: "callerToken",
        callId: callId
      }));

      // The callee connects!
      callee.send(JSON.stringify({
        messageType: constants.MESSAGE_TYPES.HELLO,
        auth: "calleeToken",
        callId: callId
      }));
    });

    it("should return the termination reason on hello.", function(done) {
      caller.on('message', function(data) {
        var message = JSON.parse(data);
        expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
        expect(message.state).eql(constants.CALL_STATES.TERMINATED);
        expect(message.reason).eql(constants.MESSAGE_REASONS.BUSY);
        done();
      });

      storage.setCallState(callId, constants.CALL_STATES.TERMINATED,
        conf.get("timers").supervisoryDuration, function(err) {
          if (err) throw err;
          storage.setCallTerminationReason(callId, constants.MESSAGE_REASONS.BUSY,
            function(err) {
              if (err) throw err;
              caller.send(JSON.stringify({
                messageType: constants.MESSAGE_TYPES.HELLO,
                auth: "callerToken",
                callId: callId
              }));
            });
        });
    });

    describe("with three clients", function() {
      var calleeSecondDevice;

      beforeEach(function(done) {

        // Create the second websocket callee.
        calleeSecondDevice = new ws("ws://localhost:" +
          server.address().port +
          conf.get('progressURLEndpoint'));

        calleeSecondDevice.on('close', function() { caller.isClosed = true; });

        calleeSecondDevice.on('open', function() {
          // Create a call and initialize its state to "init".
          createCall(callId, hawkCredentials.id, function(err) {
            if (err) throw err;
            storage.setCallState(callId, constants.CALL_STATES.INIT,
              conf.get("timers").supervisoryDuration, function(err) {
                if (err) throw err;
                done();
              });
          });
        });
      });

      afterEach(function(done) {
        if (! calleeSecondDevice.isClosed) {
          calleeSecondDevice.close();
        }
        done();
      });

      it("should send terminated 'answered-elsewhere' if the call had been " +
         "accepted by another device", function(done) {
          var callerMsgCount = 0;
          var calleeSecondDeviceCount = 0;

          function checkCountsAndExit() {
            if (callee.isClosed &&
                caller.isClosed &&
                calleeSecondDevice.isClosed) {
              expect(calleeSecondDeviceCount).to.eql(3);
              expect(calleeMsgCount).to.eql(5);
              expect(callerMsgCount).to.eql(5);
              done();
            }
          }

          callee.on('close', function() {
            callee.isClosed = true;
            checkCountsAndExit();
          });

          caller.on('close', function() {
            caller.isClosed = true;
            checkCountsAndExit();
          });

          calleeSecondDevice.on('close', function() {
            calleeSecondDevice.isClosed = true;
          });

          calleeSecondDevice.on('message', function(data) {
            var message = JSON.parse(data);
            if (calleeSecondDeviceCount === 0) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
              expect(message.state).eql(constants.CALL_STATES.INIT);
            } else if (calleeSecondDeviceCount === 1) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
              expect(message.state).eql(constants.CALL_STATES.ALERTING);
            } else if (calleeSecondDeviceCount === 2) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
              expect(message.state).eql(constants.CALL_STATES.TERMINATED);
              expect(message.reason)
                .eql(constants.MESSAGE_REASONS.ANSWERED_ELSEWHERE);
            }
            calleeSecondDeviceCount++;
          });

          caller.on('message', function(data) {
            var message = JSON.parse(data);
            if (callerMsgCount === 0) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
              expect(message.state).eql(constants.CALL_STATES.INIT);
            } else if (callerMsgCount === 1) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
              expect(message.state).eql(constants.CALL_STATES.ALERTING);
            } else if (callerMsgCount === 2) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
              expect(message.state).eql(constants.CALL_STATES.CONNECTING);
              message = JSON.stringify({
                messageType: constants.MESSAGE_TYPES.ACTION,
                event: constants.MESSAGE_EVENTS.MEDIA_UP
              });
              caller.send(message);
            } else if (callerMsgCount === 3) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
              expect(message.state).eql(constants.CALL_STATES.HALF_CONNECTED);
            } else {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
              expect(message.state).eql(constants.CALL_STATES.CONNECTED);
            }
            callerMsgCount++;
          });

          callee.on('message', function(data) {
            var message = JSON.parse(data);
            if (calleeMsgCount === 0) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.HELLO);
              expect(message.state).eql(constants.CALL_STATES.INIT);
              callee.send(JSON.stringify({
                messageType: constants.MESSAGE_TYPES.ACTION,
                event: constants.MESSAGE_EVENTS.ACCEPT
              }));
            } else if (calleeMsgCount === 1) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
              expect(message.state).eql(constants.CALL_STATES.ALERTING);
            } else if (calleeMsgCount === 2) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
              expect(message.state).eql(constants.CALL_STATES.CONNECTING);
            } else if (calleeMsgCount === 3) {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
              expect(message.state).eql(constants.CALL_STATES.HALF_CONNECTED);
              message = JSON.stringify({
                messageType: constants.MESSAGE_TYPES.ACTION,
                event: constants.MESSAGE_EVENTS.MEDIA_UP
              });
              callee.send(message);
            } else {
              expect(message.messageType).eql(constants.MESSAGE_TYPES.PROGRESS);
              expect(message.state).eql(constants.CALL_STATES.CONNECTED);
            }
            calleeMsgCount++;
          });

          // Second device for the callee connects.
          calleeSecondDevice.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.HELLO,
            auth: "calleeToken",
            callId: callId
          }));

          caller.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.HELLO,
            auth: "callerToken",
            callId: callId
          }));

          // The callee connects his first device.
          callee.send(JSON.stringify({
            messageType: constants.MESSAGE_TYPES.HELLO,
            auth: "calleeToken",
            callId: callId
          }));
        });
    });
  });
});
