/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var WebSocket = require('ws');
var PubSub = require('./pubsub');

function MessageHandler(pub, sub, storage, tokenManager) {
  this.pub = pub;
  this.sub = sub;
  this.storage = storage;
  this.tokenManager = tokenManager;
}

MessageHandler.prototype = {

  /**
   * Parses a message and dispatches it to the right handler.
   **/
  dispatch: function(session, data, cb) {
    var inboundMessage = this.decode(data);

    var handlers = {
      hello: "handleHello",
      action: "handleAction"
    };

    var messageType = inboundMessage.messageType;

    if (!handlers.hasOwnProperty(messageType)) {
      cb(new Error("Unknown messageType"));
      return;
    }
    var handler = this[handlers[messageType]].bind(this);
    handler(session, inboundMessage, function(err, outboundMessage) {
      cb(err, this.encode(outboundMessage));
    }.bind(this));
  },

  /**
   * Handles the hello message.
   *
   * Does authentication (checks that the passed hawk credentials are valid,
   * and answers with the status of the call.
   *
   * In addition to that, listens on the pubsub for forward events about this
   * call.
   **/
  handleHello: function(session, message, cb) {
    // Check that message contains requireParams, otherwise return an error.
    try {
      this.requireParams(message, 'callId', 'authType', 'auth');
    } catch (e) {
      cb(e);
      return;
    }

    // Configure the current session with user information.
    session.callId = message.callId;

    var self = this;
    var authType = message.authType.toLowerCase();
    var tokenId = message.auth;

    function processCall(call) {
      session.type = (call.userMac === session.user) ? "callee" : "caller";

      // Get current call state to answer hello message.
      self.storage.getCallState(session.callId, function(err, state) {
        if (err) throw err;

        // Alert clients on call state changes.
        self.sub.on("message", function(channel, receivedState) {
          if (channel === session.callId) {
            cb(null, {
              messageType: "progress",
              state: receivedState
            });
          }
        });

        // Subscribe to the channel to setup progress updates.
        self.sub.subscribe(session.callId);

        cb(null, {
          messageType: "hello",
          state: state
        });

        // After the hello phase and as soon the calle is connected,
        // set the alerting state.
        if (state === "init" && session.type === "callee") {
          self.broadcastState(session.callId, "alerting");
        }
      });
    }

    self.storage.getCall(session.callId, function(err, call) {
      if (err) throw err;

      if (call === null) {
        cb(new Error("bad callId"));
        return;
      }

      if (authType === "hawk") {
        self.storage.getHawkSession(tokenId, function(err, hawkCredentials) {
          if (err) throw err;

          if (hawkCredentials === null) {
            cb(new Error("bad authentication"));
            return;
          }

          self.storage.getHawkUser(tokenId, function(err, user) {
            if (err) throw err;

            if (user !== null) {
              session.user = user;
            } else {
              session.user = tokenId;
            }

            processCall(call);
          });
        });
      } else if (authType === "token") {
        var token;

        try {
          token = self.tokenManager.decode(tokenId);
        } catch (e) {
          cb(new Error("Bad token: " + e.message));
          return;
        }

        if (token.user !== call.userMac) {
          cb(new Error("Bad token for this callId."));
          return;
        }
        processCall(call);
      }
    });
  },

  /**
   * Handles state changes submitted by the clients.
   *
   * Update the current state of the call using the information passed by the
   * clients. Once the new state is defined, broadcast it to the interested
   * parties using the pubsub.
   **/
  handleAction: function(session, message, cb) {
    // We received a session changed
    try {
      this.requireParams(message, "event");
    } catch (e) {
      cb(e);
      return;
    }

    var validEvents = ["accept", "media-up", "terminate"];
    var event = message.event;
    var self = this;

    if (validEvents.indexOf(event) === -1) {
      cb(
        new Error(event + " state is invalid. Should be: " +
                  validEvents.join(", "))
      );
      return;
    }

    // If terminate, close the call
    if (event === "terminate") {
      self.broadcastState(session.callId, "terminated");
      return;
    }

    // Get current state
    self.storage.getCallState(session.callId, function(err, currentState) {

      // Ensure half-connected is not send twice by the same party.
      var validateState = function(currentState, transition) {
        if (currentState === "connecting" ||
            currentState === "half-connected") {
          return "connected." + session.type;
        }
        return null;
      };

      var stateMachine = {
        "accept": {
          transitions: [
            ["alerting", "connecting"]
          ]
        },
        "media-up": {
          transitions: [
            ["connecting"],
            ["half-connected"]
          ],
          validator: validateState
        }
      };

      var handled = false;

      if (stateMachine.hasOwnProperty(event)) {
        var eventConf = stateMachine[event];

        var state;

        eventConf.transitions.forEach(function(transition, key) {
          if (transition[0] === currentState) {
            handled = true;
            var validator = eventConf.validator;
            if (validator !== undefined) {
              state = validator(currentState, transition);
            } else {
              state = transition[1];
            }
            if (state !== null) {
              // In case we're connected, close the connection.
              self.broadcastState(session.callId, state);
                // function(err, redisCurrentState) {
                //   if (redisCurrentState === "connected") {
                //     throw new Error("End of setup");
                //   }
                // });
            }
            return;
          }
        });
      }
      if (!handled) {
        cb(
          new Error("No transition from " + currentState + " state with " +
                    event + " event.")
        );
      }
    });
  },

  /**
   * Broadcast the call-state data to the interested parties.
   **/
  broadcastState: function(callId, state, cb) {
    var self = this;

    self.storage.setCallState(callId, state, function(err) {
      if (err) throw err;

      self.storage.getCallState(callId, function(err, redisCurrentState) {
        if (err) throw err;

        self.pub.publish(callId, redisCurrentState, function(err) {
          if (err) throw err;
          if (cb !== undefined) {
            cb(null, redisCurrentState);
          }
        });
      });
    });
  },

  /**
   * Creates an error message to be consumed by the client.
   **/
  createError: function(errorMessage) {
    return this.encode({
      messageType: "error",
      reason: errorMessage
    });
  },

  encode: function(data) {
    return JSON.stringify(data);
  },

  decode: function(data) {
    return JSON.parse(data);
  },

  /**
   * Checks that the given parameters are present in the message.
   *
   * Message is passed as the last argument of the function.
   **/
  requireParams: function() {
    var params = Array.prototype.slice.call(arguments);
    var inboundMessage = params.shift();

    var missingParams;

    missingParams = params.filter(function(param) {
      return inboundMessage[param] === undefined;
    });

    if (missingParams.length > 0) {
      throw new Error("Missing parameters: " + missingParams.join(', '));
    }
  }
};

module.exports = function(storage, tokenManager, logError, conf) {
  /**
   * Allow a server to register itself as a websocket provider.
   **/
  var register = function(server) {
    var pub = new PubSub(conf.get('pubsub'));
    var sub = new PubSub(conf.get('pubsub'));
    var messageHandler = new MessageHandler(pub, sub, storage, tokenManager);
    var wss = new WebSocket.Server({server: server});

    wss.on('connection', function(ws) {
      var session = {};
      // Check authentication with hawk.
      ws.on('message', function(data) {
        try {
          messageHandler.dispatch(session, data,
            function(err, outboundMessage, terminate) {
              // Handle regular error.
              if (err) {
                ws.send(messageHandler.createError(err.message));
                ws.close();
                return;
              }

              ws.send(outboundMessage);
              if (terminate === "closeConnection") {
                ws.close();
              }
            });
        } catch(e) {
          // Handle programmation / uncatched errors.
          ws.send(messageHandler.createError(new Error("Service Unavailable")));
          ws.close();
        }
      });
      ws.on('close', function() {
        ws.close();
      });
      ws.on('error', console.log);
    });
  };

  return {
    'register': register
  };
};
