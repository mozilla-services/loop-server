/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var sinon = require("sinon");
var crypto = require("crypto");

var ws = require('ws');

var Token = require("express-hawkauth").Token;
var hmac = require("../loop/hmac");

var loop = require("../loop");
var server = loop.server;
var storage = loop.storage;
var conf = loop.conf;

function createCall(callId, user, cb) {
  storage.addUserCall(user, {
    callerId: 'Alexis',
    callId: callId,
    userMac: user,
    sessionId: '1234',
    calleeToken: '1234',
    callState: "init",
    timestamp: Date.now(),
    wsCallerToken: "callerToken",
    wsCalleeToken: "calleeToken"
  }, cb);
}

describe('websockets', function() {
  var client, hawkCredentials, userHmac, sandbox;

  beforeEach(function(done) {
    this.timeout(5000);
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
        userHmac = hmac(tokenId, conf.get('hawkIdSecret'));
        storage.setHawkSession(userHmac, authKey, done);
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

  it('should echo back a message', function(done) {
    client.on('message', function(data) {
      var message = JSON.parse(data);
      expect(message.messageType).eql('echo');
      expect(message.echo).eql('foo');
      done();
    });
    client.send(JSON.stringify({
      messageType: 'echo',
      echo: 'foo'
    }));
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
        auth: 'wrongCalleeToken',
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
        auth: "calleeToken",
        callId: '1234'
      }));
    });

  it('should accept caller authenticating with a valid token url',
    function(done) {
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
            auth: "callerToken",
            callId: callId
          }));
        });
      });
    });

  it('should return the state of the call', function(done) {
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
      callId = crypto.randomBytes(16).toString('hex');

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
          storage.setCallState(callId, "init",
            conf.get("timers").supervisoryDuration, function(err) {
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
          auth: "callerToken",
          callId: callId
        }));

        // Callee registers to the socket.
        callee.send(JSON.stringify({
          messageType: 'hello',
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
          auth: "callerToken",
          callId: callId
        }));

        callee.send(JSON.stringify({
          messageType: 'hello',
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
            caller.isClosed = true;
            if (callee.isClosed) done();
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
            callee.isClosed = true;
            if (caller.isClosed) done();
          }
          calleeMsgCount++;
        });


        caller.send(JSON.stringify({
          messageType: 'hello',
          auth: "callerToken",
          callId: callId
        }));

        callee.send(JSON.stringify({
          messageType: 'hello',
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
        if (message.state === "half-connected") {
          caller.send(JSON.stringify({
            messageType: 'action',
            event: 'media-up'
          }));
        }
      });

      callee.on('message', function(data) {
        var message = JSON.parse(data);
        if (message.state === "alerting") {
          callee.send(JSON.stringify({
            messageType: 'action',
            event: 'accept'
          }));
        } else if (message.state === "connecting") {
          callee.send(JSON.stringify({
            messageType: 'action',
            event: 'media-up'
          }));
        }
      });

      caller.send(JSON.stringify({
        messageType: 'hello',
        auth: "callerToken",
        callId: callId
      }));

      callee.send(JSON.stringify({
        messageType: 'hello',
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
        messageType: 'hello',
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
          if (message.messageType === "hello") {
            caller.send(JSON.stringify({
              messageType: 'action',
              event: 'terminate',
              reason: 't#i5-!s-the-@nd'
            }));
          } else {
            expect(message.messageType).eql("error");
            expect(message.reason)
              .eql("Invalid reason: should be alphanumeric");
          }
        });

        caller.send(JSON.stringify({
          messageType: 'hello',
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
        if (message.messageType === "hello") {
          caller.send(JSON.stringify({
            messageType: 'action',
            event: 'terminate',
            reason: 'cancel'
          }));
        } else {
          expect(message.messageType).eql("progress");
          expect(message.state).eql("terminated");
          expect(message.reason).eql("cancel");
        }
      });

      caller.send(JSON.stringify({
        messageType: 'hello',
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
        if (message.messageType === "hello") return;
        if (message.messageType === "progress") {
          caller.send(JSON.stringify({
            messageType: 'action',
            event: 'media-up'
          }));
        } else {
          expect(message.messageType).eql("error");
          expect(message.reason).eql(
            "No transition from alerting state with media-up event.");
        }
      });

      caller.send(JSON.stringify({
        messageType: 'hello',
        auth: "callerToken",
        callId: callId
      }));

      callee.send(JSON.stringify({
        messageType: 'hello',
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
          if (message.messageType === "progress") {
            expect(message.state).eql("terminated");
            expect(message.reason).eql("timeout");
          }
        });

        caller.send(JSON.stringify({
          messageType: 'hello',
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
          if (message.messageType === "progress") {
            expect(message.state).eql("terminated");
            expect(message.reason).eql("timeout");
          }
        });

        callee.send(JSON.stringify({
          messageType: 'hello',
          auth: "calleeToken",
          callId: callId
        }));
      });

    it("should not broadcast progress/terminate if callee subscribed in " +
       "less than X seconds", function(done) {
        caller.on('message', function(data) {
          var message = JSON.parse(data);
          if (message.messageType === "hello") {
            // The callee connects!
            callee.send(JSON.stringify({
              messageType: 'hello',
              auth: "calleeToken",
              callId: callId
            }));
          } else if (message.messageType === "progress"){
            expect(message.state).not.eql("terminated");
            done();
          }
        });
        caller.send(JSON.stringify({
          messageType: 'hello',
          auth: "callerToken",
          callId: callId
        }));
      });

    it("should not broadcast progress/terminate if caller subscribed in " +
       "less than X seconds", function(done) {
        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (message.messageType === "hello") {
            // The callee connects!
            caller.send(JSON.stringify({
              messageType: 'hello',
              auth: "callerToken",
              callId: callId
            }));
          } else if (message.messageType === "progress"){
            expect(message.state).not.eql("terminated");
            done();
          }
        });
        callee.send(JSON.stringify({
          messageType: 'hello',
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
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
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
          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("terminated");
            expect(message.reason).eql("timeout");
          }
          calleeMsgCount++;
        });

        caller.send(JSON.stringify({
          messageType: 'hello',
          auth: "callerToken",
          callId: callId
        }));

        // The callee connects!
        callee.send(JSON.stringify({
          messageType: 'hello',
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
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
          }
          callerMsgCount++;
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
            callee.send(JSON.stringify({
              messageType: "action",
              event: "accept"
            }));
          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
            done();
          }
          calleeMsgCount++;
        });

        caller.send(JSON.stringify({
          messageType: 'hello',
          auth: "callerToken",
          callId: callId
        }));

        // The callee connects!
        callee.send(JSON.stringify({
          messageType: 'hello',
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
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
          } else if (callerMsgCount === 2) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("terminated");
            expect(message.reason).eql("timeout");
          }
          callerMsgCount++;
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
            callee.send(JSON.stringify({
              messageType: "action",
              event: "accept"
            }));
          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
          } else if (calleeMsgCount === 2) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("terminated");
            expect(message.reason).eql("timeout");
          }
          calleeMsgCount++;
        });

        caller.send(JSON.stringify({
          messageType: 'hello',
          auth: "callerToken",
          callId: callId
        }));

        // The callee connects!
        callee.send(JSON.stringify({
          messageType: 'hello',
          auth: "calleeToken",
          callId: callId
        }));
      });

    it("should close the connection if media-up send by only one party",
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
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
          } else if (callerMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
          } else if (callerMsgCount === 2) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
            callee.send(JSON.stringify({
              messageType: "action",
              event: "media-up"
            }));
          } else if (callerMsgCount === 3) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("half-connected");
          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("terminated");
            expect(message.reason).eql("timeout");
          }
          callerMsgCount++;
        });

        callee.on('message', function(data) {
          var message = JSON.parse(data);
          if (calleeMsgCount === 0) {
            expect(message.messageType).eql("hello");
            expect(message.state).eql("init");
            caller.send(JSON.stringify({
              messageType: "action",
              event: "accept"
            }));
          } else if (calleeMsgCount === 1) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("alerting");
          } else if (calleeMsgCount === 2) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("connecting");
          } else if (calleeMsgCount === 3) {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("half-connected");
          } else {
            expect(message.messageType).eql("progress");
            expect(message.state).eql("terminated");
            expect(message.reason).eql("timeout");
          }
          calleeMsgCount++;
        });

        caller.send(JSON.stringify({
          messageType: 'hello',
          auth: "callerToken",
          callId: callId
        }));

        // The callee connects!
        callee.send(JSON.stringify({
          messageType: 'hello',
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
          expect(message.messageType).eql("hello");
          expect(message.state).eql("init");
        } else if (callerMsgCount === 1) {
          expect(message.messageType).eql("progress");
          expect(message.state).eql("alerting");
        } else if (callerMsgCount === 2) {
          expect(message.messageType).eql("progress");
          expect(message.state).eql("connecting");
          caller.send(JSON.stringify({
            messageType: "action",
            event: "media-up"
          }));
        } else if (callerMsgCount === 3) {
          expect(message.messageType).eql("progress");
          expect(message.state).eql("half-connected");
        } else {
          expect(message.messageType).eql("progress");
          expect(message.state).eql("connected");
        }
        callerMsgCount++;
      });

      callee.on('message', function(data) {
        var message = JSON.parse(data);
        if (calleeMsgCount === 0) {
          expect(message.messageType).eql("hello");
          expect(message.state).eql("init");
          callee.send(JSON.stringify({
            messageType: "action",
            event: "accept"
          }));
        } else if (calleeMsgCount === 1) {
          expect(message.messageType).eql("progress");
          expect(message.state).eql("alerting");
        } else if (calleeMsgCount === 2) {
          expect(message.messageType).eql("progress");
          expect(message.state).eql("connecting");
        } else if (calleeMsgCount === 3) {
          expect(message.messageType).eql("progress");
          expect(message.state).eql("half-connected");
          callee.send(JSON.stringify({
            messageType: "action",
            event: "media-up"
          }));
        } else {
          expect(message.messageType).eql("progress");
          expect(message.state).eql("connected");
        }
        calleeMsgCount++;
      });

      caller.send(JSON.stringify({
        messageType: 'hello',
        auth: "callerToken",
        callId: callId
      }));

      // The callee connects!
      callee.send(JSON.stringify({
        messageType: 'hello',
        auth: "calleeToken",
        callId: callId
      }));
    });
  });
});
