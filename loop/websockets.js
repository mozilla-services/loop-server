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
  dispatch: function(data) {
    var message = this.decode(data);

    var handlers = {
      hello: "handleHello",
      progress: "handleProgress"
    };

    var messageType = message.messageType.toLowerCase();

    if (!handlers.hasOwnProperty(messageType)) {
      throw new Error("Unknown messageType");
    }
    var handler = this[handlers[messageType]];
    return this.encode(handler(message));
  },

  handleHello: function(message) {
    // Check that message contains callId, otherwise return an error.
    this.requireParams(message, 'callId', 'auth');

    // Check authentication

    // XXX We want to sign messages with the hawkId + secret rather than using
    // it as a bearer token.
    var hawkId = message.auth;
    this.storage.

    // Subscribe to the channel 
    this.subscribe(message.callId, function(state) {
    });

    return {
      messageType: "hello",
      state: state
    };
  },

  handleProgress: function(message) {
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
    var message = params.shift();

    var missingParams;

    missingParams = params.filter(function(param) {
      return message[param] === undefined;
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
      // Check authentication with hawk.
      ws.on('message', function(data) {
        try {
          ws.send(messageHandler.dispatch(data));
        } catch(e) {
          ws.send(messageHandler.createError(e.message));
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
