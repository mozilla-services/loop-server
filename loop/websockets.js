/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var WebSocket = require('ws');
var PubSub = require('./pubsub');

function MessageHandler(pubsub, storage) {
  this.pubsub = pubsub;
  this.storage = storage;
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
    var handler = this[handlers[messageType]];
    handler(inboundMessage, function(outboundMessage) {
      cb(null, this.encode(outboundMessage));
    });
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
      this.requireParams(message, 'callId', 'auth');
    } catch (e) {
      cb(e);
      return;
    }

    // Check authentication
    // XXX We want to sign messages with the hawkId + secret rather
    // than using it as a bearer token.
    var hawkId = message.auth;
    this.storage.getHawkSession(hawkId, function(err, hawkCredentials) {
      if(err) throw new Error("bad authentication");
      this.storage.getHawkUser(hawkId, function(err, user) {
        if (user !== null) {
          session.user = user;
        } else {
          session.user = hawkId;
        }

        this.storage.getCall(session.callId, function(err, call) {
          if (err) {
            cb(err);
            return;
          }

          session.type = (call.userMac === session.user) ? "caller" : "caller";

          // Get current call state to answer hello message.
          this.storage.getCallState(session.callId, function(err, state) {
            if (err) {
              cb(err);
              return;
            }

            // Answer the hello message.
            cb(null, {
              messageType: "hello",
              state: state
            });
          });

          // Alert clients on call state changes.
          this.pubsub.on("message", function(channel, receivedState) {
            if (channel !== session.callId) {
              this.handleCallStateChange(session, receivedState, cb);
            }
          });

          // Subscribe to the channel to setup progress updates.
          this.pubsub.subscribe(session.callId);
        });
      });
    });

    // Configure the current session with user information.
    session.callId = message.callId;

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

    if (validEvents.indexOf(event) === -1) {
      cb(
        new Error(event + " state is invalid. Should be: " +
                  validEvents.join(", "))
      );
      return;
    }

    // If terminate, close the call
    if (event === "terminate") {
      this.broadcastState(session.callId, "terminated", cb);
      return;
    }

    // Get current state
    this.storage.getCallState(session.callId, function(err, currentState) {

      // Ensure half-connected is not send twice by the same party.
      var validateState = function(callId, currentState, event) {
        return true;
      };

      var stateMachine = {
        "accept": {
          transitions: [
            ["alerting", "connecting"]
          ],
        },
        "media-up": {
          transitions: [
            ["connecting", "half-connected"],
            ["half-connected", "connected"]
          ],
          validator: validateState
        }
      };

      var handled = false;

      if (stateMachine.hasOwnProperty(event)) {
        var validated = true;
        var state = stateMachine[event];

        state.transitions.forEach(function(transition, key) {
          if(transition[0] === currentState) {
            handled = true;
            var validator = stateMachine[event].validator;
            if (validator !== undefined) {
              if (!validator(session.callId, currentState, event)) {
                validated = false;
              }
            }
            if (validated === true) {

              // In case we're connected, close the connection.
              var terminate;
              if (transition[1] === "connected") {
                terminate = "closeConnection";
              }
              this.broadcastState(session.callId, transition[1], terminate, cb);
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
  broadcastState: function(callId, state, closeConnection, cb) {
    if (cb === undefined) {
      cb = closeConnection;
      closeConnection = undefined;
    }

    this.storage.setCallState(callId, state, function(err) {
      if (err) throw err;

      this.pubsub.publish(callId, state, function(err) {
        if (err) throw err;

        cb(null, {
          messageType: "progress",
          state: state
        }, closeConnection);
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

module.exports = function(storage, logError, conf) {
  /**
   * Allow a server to register itself as a websocket provider.
   **/
  var register = function(server) {
    var pubsub = new PubSub(conf.get('pubsub'));
    var messageHandler = new MessageHandler(pubsub, storage);
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
