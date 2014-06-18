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

    if (!handlers.hasOwnProperty(messageType)) {
      cb(new Error("Unknown messageType"));
      return;
    }
    var handler = this[handlers[messageType]];
    handler(inboundMessage, function(outboundMessage) {
      cb(null, this.encode(outboundMessage));
    });
  },

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

    // Configure the current session with user information.
    session.callId = message.callId;

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
  },

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
      var stateMachine = {
        "accept": [
          ["alerting", "connecting"]
        ],
        "media-up": [
          ["connecting", "half-connected"],
          ["half-connected", "connected"],
          validateState
        ]
      };

      // Get the validator
      var validator = stateMachine[event].pop();
      if (typeof validator === "object") {
        stateMachine[event].push(validator);
        validator = undefined;
      }

      var handled = false;

      stateMachine[event].forEach(function(transition, key) {
        if (transition[0] === currentState) {
          handled = true;
          if (validator !== undefined) {
            if (validator(callId, currentState, event)) {
              this.broadcastState(session.callId, stateMachine[event][1], cb);
            }
            return;
          }
          this.broadcastState(session.callId, stateMachine[event][1], cb);
        }
      });

      if (!handled) {
        cb(
          new Error("No transition from " + currentState +
                    " state with " + event + " event.")
        );
      }
    });
  },

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
  var register = function(server) {
    var pubsub = new PubSub(conf.get('pubsub'));
    var messageHandler = new MessageHandler(pubsub, storage);
    var wss = new WebSocket.Server({server: server});

    wss.on('connection', function(ws) {
      var session = {};
      // Check authentication with hawk.
      ws.on('message', function(data) {
        try {
          messageHandler.dispatch(session, data, function(err, outboundMessage, terminate) {
            // Regular error
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
          // Programmation error.
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
