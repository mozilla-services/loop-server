/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var PubSub = require('./pubsub');
var conf = require('./config').conf;
var hekaLogger = require('./logger').hekaLogger;
var isoDateString = require("./utils").isoDateString;
var constants = require("./constants");

/**
 * Sends an error to the given callback, if there is any.
 *
 * Attaches an "isCritical" property, set to true in case of error.
 **/
function serverError(error, callback) {
  if (error) {
    error.isCritical = true;
    if (callback) callback(error);
    return true;
  }
  return false;
}

/**
 * Handles the messages coming from the transport layer, and answers to them.
 *
 * Transport is defined outside the message handler itself.
 **/
function MessageHandler(pub, sub, storage, conf) {
  this.pub = pub;
  this.sub = sub;
  this.storage = storage;
  this.conf = conf;
}

MessageHandler.prototype = {

  /**
   * Parses a message and dispatches it to the right handler (method) of this
   * class.
   **/
  dispatch: function(session, data, callback) {
    var inboundMessage;
    try {
      inboundMessage = this.decode(data);
    } catch (e) {
      callback(new Error("Malformed message."));
      return;
    }

    var handlers = {
      hello: "handleHello",
      action: "handleAction",
      echo: "handleEcho"
    };

    var messageType = inboundMessage.messageType;

    if (!handlers.hasOwnProperty(messageType)) {
      callback(new Error("Unknown messageType"));
      return;
    }
    var handler = this[handlers[messageType]].bind(this);
    handler(session, inboundMessage, function(err, outboundMessage, terminate) {
      callback(err, this.encode(outboundMessage), terminate);
    }.bind(this));
  },

  /**
   * Just echoes back a message that's being sent.
   **/
  handleEcho: function(session, message, callback) {
    callback(
      null, {messageType: constants.MESSAGE_TYPES.ECHO, echo: message.echo}
    );
  },

  /**
   * Handles hello messages.
   *
   * Checks authentication and answers with the status of the call.
   *
   * In addition to that, listens on the pubsub for forward events about this
   * call.
   **/
  handleHello: function(session, message, callback) {
    // Check that message contains requireParams, otherwise return an error.
    try {
      this.requireParams(message, 'callId', 'auth');
    } catch (e) {
      callback(e);
      return;
    }

    // Configure the current session with user information.
    session.callId = message.callId;

    var self = this;
    var tokenId = message.auth;

    self.storage.getCall(session.callId, function(err, call) {
      if (serverError(err, callback)) return;

      if (call === null) {
        callback(new Error(constants.ERROR_REASONS.BAD_CALLID));
        return;
      }

      if (call.wsCalleeToken === tokenId) {
        session.type = "callee";
      } else if (call.wsCallerToken === tokenId) {
        session.type = "caller";
      } else {
        callback(new Error(constants.ERROR_REASONS.BAD_AUTHENTICATION));
        return;
      }
      self.storage.incrementConnectedCallDevices(session.type, session.callId,
        function(){
        // Get current call state to answer hello message.
        self.storage.getCallState(session.callId, function(err, currentState) {
          if (serverError(err, callback)) return;
          self.storage.getCallTerminationReason(session.callId, function(err, reason) {
            if (serverError(err, callback)) return;

            // Alert clients on call state changes.
            var onMessage = function(channel, data) {
              var parts = data.split(":");
              var receivedState = parts[0];
              var reason = parts[1];
              var terminate;

              // Discard all messages which aren't for this session.
              if (channel === session.callId) {

                if (receivedState === constants.CALL_STATES.TERMINATED ||
                    receivedState === constants.CALL_STATES.CONNECTED) {
                  terminate = "closeConnection";
                }

                // If received state is "connecting" but the session is not
                // marked as such, it means that it was answered elsewhere.
                if (receivedState === constants.CALL_STATES.CONNECTING &&
                    session.type === "callee" && !session.accepted) {
                  receivedState = constants.CALL_STATES.TERMINATED;
                  reason = constants.MESSAGE_REASONS.ANSWERED_ELSEWHERE;
                  terminate = "closeConnection";
                }
                if (session.receivedState !== receivedState) {
                  // Store the received state we sent to be sure not to send it
                  // twice.
                  session.receivedState = receivedState;

                  var message = {
                    messageType: constants.MESSAGE_TYPES.PROGRESS,
                    state: receivedState
                  };
                  if (reason !== undefined) {
                    message.reason = reason;
                  }

                  callback(null, message, terminate);
                }
              }
            };

            self.sub.on("message", onMessage);
            // keep track of the active listeners
            session.subListeners.push(onMessage);

            // Wait for the other caller to connect for the time of the call.
            session.timeouts.push(setTimeout(function() {
              // Supervisory timer: Until the callee says HELLO
              self.storage.getCallState(session.callId, function(err, state) {
                if (serverError(err, callback)) return;
                if (state === constants.CALL_STATES.HALF_INITIATED) {

                  self.broadcastState(session,
                                      constants.CALL_STATES.TERMINATED + ":" +
                                      constants.MESSAGE_REASONS.TIMEOUT);
                }
              });
            }, conf.get("timers").supervisoryDuration * 1000));

            // Subscribe to the channel to setup progress updates.
            self.sub.subscribe(session.callId);

            // Don't publish the half-initiated state, it's only for internal
            // use.
            var helloState = currentState;
            if (currentState === constants.CALL_STATES.HALF_INITIATED) {
              helloState = constants.CALL_STATES.INIT;
            }

            callback(null, {
              messageType: constants.MESSAGE_TYPES.HELLO,
              state: helloState,
              reason: reason || undefined
            });

            // After the hello phase and as soon the callee is connected,
            // the call changes to the "alerting" state.
            if (currentState === constants.CALL_STATES.INIT ||
                currentState === constants.CALL_STATES.HALF_INITIATED) {

              self.broadcastState(
                session,
                constants.CALL_STATES.INIT + "." + session.type
              );

              if (session.type === "callee") {
                session.timeouts.push(setTimeout(function() {
                  // Ringing timer until the callee picks up the phone
                  self.storage.getCallState(session.callId, function(err, state) {
                    if (serverError(err, callback)) return;
                    if (state === constants.CALL_STATES.ALERTING) {
                      self.broadcastState(
                        session,
                        constants.CALL_STATES.TERMINATED + ":" +
                        constants.MESSAGE_REASONS.TIMEOUT
                      );
                    }
                  });
                }, self.conf.ringingDuration * 1000));
              }

            }
          });
        });
      });
    });
  },

  /**
   * Handle state changes submitted by the clients.
   *
   * Update the current state of the call using the information passed by the
   * clients. Once the new state is defined, broadcast it to the interested
   * parties using the pubsub.
   **/
  handleAction: function(session, message, callback) {
    try {
      this.requireParams(message, "event");
    } catch (e) {
      callback(e);
      return;
    }

    var validEvents = [
      constants.MESSAGE_EVENTS.ACCEPT,
      constants.MESSAGE_EVENTS.MEDIA_UP,
      constants.MESSAGE_EVENTS.TERMINATE
    ];
    var event = message.event;
    var self = this;

    if (validEvents.indexOf(event) === -1) {
      callback(
        new Error(event + " state is invalid. Should be one of: " +
                  validEvents.join(", "))
      );
      return;
    }

    // If terminate, close the call.
    if (event === constants.MESSAGE_EVENTS.TERMINATE) {
      var state = constants.CALL_STATES.TERMINATED;

      // Check the reason is a valid one, fail otherwise.
      if (message.reason !== undefined) {
        if (message.reason.match(/^[a-zA-Z0-9\-]+$/) === null) {
          callback(new Error(constants.ERROR_REASONS.BAD_REASON));
          return;
        }
        state += ":" + message.reason;
      }
      self.broadcastState(session, state);
      return;
    }

    // Get current state
    self.storage.getCallState(session.callId, function(err, currentState) {
      if (serverError(err, callback)) return;

      // Ensure half-connected is not send twice by the same party.
      var validateState = function(currentState) {
        if (currentState === constants.CALL_STATES.CONNECTING ||
            currentState === constants.CALL_STATES.HALF_CONNECTED) {
          return constants.CALL_STATES.CONNECTED + "." + session.type;
        }
        return null;
      };

      var stateMachine = {
        "accept": {
          transitions: [
            [constants.CALL_STATES.ALERTING, constants.CALL_STATES.CONNECTING]
          ],
          actuator: function() {
            session.timeouts.push(setTimeout(function() {
              // Connection timer until both sends media-up.
              self.storage.getCallState(session.callId, function(err, state) {
                if (serverError(err, callback)) return;
                if (state !== constants.CALL_STATES.CONNECTED) {

                  self.broadcastState(session,
                                      constants.CALL_STATES.TERMINATED + ":" +
                                      constants.MESSAGE_REASONS.TIMEOUT);
                }
              });
            }, self.conf.connectionDuration * 1000));
          }
        },
        "media-up": {
          transitions: [
            [constants.CALL_STATES.CONNECTING],
            [constants.CALL_STATES.HALF_CONNECTED]
          ],
          validator: validateState
        }
      };

      var handled = false;

      if (stateMachine.hasOwnProperty(event)) {
        var eventConf = stateMachine[event];

        var state;

        eventConf.transitions.forEach(function(transition) {
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
              self.broadcastState(session, state);

              // Handle specific actions on transitions.
              if (eventConf.actuator !== undefined) {
                eventConf.actuator();
              }
            }
            return;
          }
        });
      }
      // If no transition was found to go from the current state to the next
      // one, send an error.
      if (!handled) {
        callback(
          new Error("No transition from " + currentState + " state with " +
                    event + " event.")
        );
      }
    });
  },

  /**
   * Broadcast the call-state data to the interested parties.
   *
   * In case there a reason to broadcast, it's specified as
   * "terminated:{reason}".
   **/
  broadcastState: function(session, stateData) {
    var self = this;
    var callId = session.callId;
    var parts = stateData.split(":");
    var state = parts[0];
    var reason = parts[1];

    // Store if the session is accepted so we can tell the other .
    if (state.split('.')[0] === constants.CALL_STATES.CONNECTING) {
      session.accepted = true;
    }

    self.storage.setCallState(callId, state, function(err) {
      if (serverError(err)) return;
      self.storage.setCallTerminationReason(callId, reason, function(err) {
        if (serverError(err)) return;
        self.storage.getCallState(callId, function(err, redisCurrentState) {
          if (serverError(err)) return;

          var publishedState = redisCurrentState;
          if (redisCurrentState === constants.CALL_STATES.TERMINATED &&
              reason !== undefined) {
            publishedState += ":" + reason;
          }

          if (redisCurrentState !== constants.CALL_STATES.HALF_INITIATED) {
            self.pub.publish(callId, publishedState, function(err) {
              if (serverError(err)) return;
            });
          }

          if (conf.get("hekaMetrics").activated &&
              (redisCurrentState === constants.CALL_STATES.CONNECTED ||
               redisCurrentState === constants.CALL_STATES.TERMINATED)) {

            hekaLogger.log('info', {
              op: 'websocket.summary',
              callId: callId,
              state: redisCurrentState,
              reason: reason,
              time: isoDateString(new Date())
            });
          }
        });
      });
    });
  },

  /**
   * Create an error message to be consumed by the client.
   **/
  createError: function(errorMessage) {
    return this.encode({
      messageType: constants.MESSAGE_TYPES.ERROR,
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
  },
  clearSession: function(session) {
    var self = this;
    session.subListeners.forEach(function(listener) {
      self.sub.removeListener("message", listener);
    });
    session.timeouts.forEach(function(timeout) {
      clearTimeout(timeout);
    });
  },

  socketClosed: function(session) {
    this.clearSession(session);
    var self = this;

    // We want to broadcast the termination only if we were the last device
    // for this type of connection
    self.storage.getConnectedCallDevices(session.type, session.callId,
      function(_, connectedDevices) {
        self.storage.decrementConnectedCallDevices(
          session.type, session.callId, function() {
            // Don't catch the errors here since we're already closing the
            // socket.
            if (connectedDevices === 1) {
              self.broadcastState(
                session,
                constants.CALL_STATES.TERMINATED + ":" +
                constants.MESSAGE_REASONS.CLOSED
              );
            }
          });
        });
  }
};

module.exports = function(storage, logError, conf) {
  var WebSocket = require('ws');
  /**
   * Allow a server to register itself as a websocket provider.
   **/
  var register = function(server) {
    var pub = new PubSub(conf.get('pubsub'));
    var sub = new PubSub(conf.get('pubsub'));

    // We need to max-out the number of listeners on the pub/sub.
    sub.setMaxListeners(0);
    var messageHandler = new MessageHandler(pub, sub, storage,
      conf.get('timers'));
    var wss = new WebSocket.Server({
      server: server,
      path: conf.get('progressURLEndpoint')
    });

    wss.on('connection', function(ws) {
      // We have a different session for each connection.
      var session = {
        subListeners: [],
        timeouts: [],
        accepted: false
      };
      ws.on('message', function(data) {
        try {
          messageHandler.dispatch(session, data,
            function(err, outboundMessage, terminate) {
              // Handle regular error.
              if (err) {
                var message;
                // Log critical errors.
                if (err.isCritical) {
                  logError(err);
                  message = "Service Unavailable";
                } else {
                  message = err.message;
                }
                try {
                  ws.send(messageHandler.createError(message));
                } catch (e) {
                  // Socket already closed (i.e, in case of race condition
                  // where we don't receive half-connected but twice
                  // connected.
                }
                ws.close();
                return;
              }

              try {
                ws.send(outboundMessage);
              } catch (e) {
                // Socket already closed (i.e, in case of race condition
                // where we don't receive half-connected but twice
                // connected.
              }

              if (terminate === "closeConnection") {
                ws.close();
              }
            });
        } catch(e) {
          // Handle programmation / uncatched errors.
          logError(e);
          try {
            ws.send(messageHandler.createError("Service Unavailable"));
          } catch (err) {
            // Socket already closed (i.e, in case of race condition
            // where we don't receive half-connected but twice
            // connected.
          }
          ws.close();
          messageHandler.socketClosed(session);
        }
      });
      ws.on('close', function() {
        ws.close();
        messageHandler.socketClosed(session);
      });
      ws.on('error', console.error);
    });
  };

  return {
    'register': register
  };
};
