/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var errors = require("../errno.json");
var sendError = require('../utils').sendError;
var getSimplePushURLS = require('../utils').getSimplePushURLS;
var tokenlib = require('../tokenlib');
var time = require('../utils').time;


module.exports = function(conf, logError, storage) {
  /**
   * Middleware that validates the given token is valid (should be included into
   * the "token" parameter.
   **/
  function validateToken(req, res, next) {
    req.token = req.params.token;
    storage.getCallUrlData(req.token, function(err, urlData) {
      if (res.serverError(err)) return;
      if (urlData === null) {
        sendError(res, 404, errors.INVALID_TOKEN, "Token not found.");
        return;
      }
      req.callUrlData = urlData;
      next();
    });
  }

  /**
   * Middleware that requires the given parameters to be set.
   * Can take a list of params to handle the OR ie: ['context', 'roomName']
   **/
  function requireParams() {
    var params = Array.prototype.slice.call(arguments);
    return function(req, res, next) {
      var missingParams;

      if (!req.accepts("json")) {
        sendError(res, 406, errors.BADJSON,
                  "Request body should be defined as application/json");
        return;
      }

      missingParams = params.filter(function(param) {
        if (Array.isArray(param)) {
          var matches = param.some(function(p) {
            return req.body[p] !== undefined;
          });
          return !matches;
        }
        return req.body[param] === undefined;
      });

      if (missingParams.length > 0) {
        sendError(res, 400, errors.MISSING_PARAMETERS,
                  "Missing: " + missingParams.join(", "));
        return;
      }
      next();
    };
  }

  /**
   * Middleware that ensures a valid simple push url is present in the request.
   **/
  function validateSimplePushURL(req, res, next) {
      if (!req.accepts("json")) {
        sendError(res, 406, errors.BADJSON,
                  "Request body should be defined as application/json");
        return;
      }

    getSimplePushURLS(req, function(err, simplePushURLs) {
      if (err) {
        sendError(res, 400, errors.INVALID_PARAMETERS, err.message);
        return;
      }
      req.simplePushURLs = simplePushURLs;
      if (Object.keys(req.simplePushURLs).length === 0) {
        sendError(res, 400, errors.MISSING_PARAMETERS,
                  "Missing: simplePushURLs.calls, simplePushURLs.rooms");
        return;
      }

      next();
    });
  }

  /**
   * Middleware that ensures a valid callType is present in the request.
   **/
  function validateCallType(req, res, next) {
    requireParams("callType")(req, res, function() {
      if (req.body.callType !== "audio" &&
          req.body.callType !== "audio-video") {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "callType should be 'audio' or 'audio-video'");
        return;
      }
      next();
    });
  }

  /**
   * Validates the call url params are valid.
   *
   * In case they aren't, error out with an HTTP 400.
   * If they are valid, store them in the urlData parameter of the request.
   **/
  function validateCallUrlParams(req, res, next) {
    var expiresIn = conf.get('callUrls').timeout,
        maxTimeout = conf.get('callUrls').maxTimeout;

    if (req.body.hasOwnProperty('expiresIn')) {
      expiresIn = parseInt(req.body.expiresIn, 10);

      if (isNaN(expiresIn)) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "expiresIn should be a valid number");
        return;
      } else if (expiresIn > maxTimeout) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "expiresIn should be less than " + maxTimeout);
        return;
      }
    }
    if (req.token === undefined) {
      req.token = tokenlib.generateToken(conf.get('callUrls').tokenSize);
    }

    req.urlData = {
      userMac: req.user,
      callerId: req.body.callerId,
      timestamp: time(),
      issuer: req.body.issuer || '',
      subject: req.body.subject || undefined
    };

    if (expiresIn !== undefined) {
      req.urlData.expires = req.urlData.timestamp +
                            expiresIn * tokenlib.ONE_HOUR;
    }
    next();
  }

  /**
   * Validates the call params passed in the body.
   *
   * In case they aren't, error out with an HTTP 400.
   **/
  function validateCallParams(req, res, next) {
    var roomsConf = conf.get('calls');

    if (req.body.hasOwnProperty('subject')) {
      if (req.body.subject.length > roomsConf.maxSubjectSize) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "Call subject should be shorter than " +
                  roomsConf.maxSubjectSize + " characters");
        return;
      }
    }

    next();
  }

  /**
   * Validate the room parameters passed in the body.
   **/
  function validateRoomParams(req, res, next) {
    var roomsConf = conf.get('rooms');

    var expiresIn = roomsConf.defaultTTL,
        maxTTL = roomsConf.maxTTL,
        serverMaxSize = roomsConf.maxSize,
        maxSize, asRoomName = false;

    if (req.body.hasOwnProperty('roomName')) {
      asRoomName = true;
      res.set("Alert", "The roomName parameter has been deprecated, you should use context.");
      if (req.body.roomName.length > roomsConf.maxRoomNameSize) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "roomName should be shorter than " +
                  roomsConf.maxRoomNameSize + " characters");
        return;
      }
    }

    if (req.body.hasOwnProperty('context')) {
      if (asRoomName) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "roomName has been deprecated, please store it " +
                  "encrypted inside the context.");
        return;
      }

      var context = req.body.context;
      if (!(context.hasOwnProperty("value") &&
            context.hasOwnProperty("alg") &&
            context.hasOwnProperty("wrappedKey"))) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "context should be an object containing " +
                  "`value`, `alg` and `wrappedKey` properties.");
        return;
      }
    }

    if (req.body.hasOwnProperty('roomOwner')) {
      if (req.body.roomOwner.length > roomsConf.maxRoomOwnerSize) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "roomOwner should be shorter than " +
                  roomsConf.maxRoomOwnerSize + " characters");
        return;
      }
    }

    if (req.body.hasOwnProperty('expiresIn')) {
      expiresIn = parseInt(req.body.expiresIn, 10);

      if (isNaN(expiresIn)) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "expiresIn should be a valid number");
        return;
      } else if (expiresIn > maxTTL) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "expiresIn cannot be greater than " + maxTTL);
        return;
      }
    }

    if(req.body.hasOwnProperty('maxSize')) {
      maxSize = parseInt(req.body.maxSize, 10);

      if (maxSize > serverMaxSize) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "maxSize cannot be greater than " + serverMaxSize);
        return;
      }
    }

    req.roomRequestData = {
      roomName: req.body.roomName,
      expiresIn: expiresIn,
      roomOwner: req.body.roomOwner,
      maxSize: maxSize
    };
    req.roomRequestContext = req.body.context;

    next();
  }

  /**
   * Validate the room status update fields passed in the body.
   **/
  function validateRoomStatusUpdate(req, res, next) {

    if (req.body.action && req.body.action === 'status') {

      // Validate mandatory fields.
      var expectedFields = [
        'event', 'state', 'connections', 'sendStreams', 'recvStreams'
      ];

      var field;

      for (var i = 0, n = expectedFields.length; i < n; i++) {
        field = expectedFields[i];
        if (!req.body.hasOwnProperty(field)) {
          sendError(res, 400, errors.INVALID_PARAMETERS,
                    "'" + field + "' field is missing in body.");
          return;
        }
      }

      // Validate positive integer values.
      var integerFields = ['connections', 'sendStreams', 'recvStreams'];
      for (i = 0; i < integerFields.length; i++) {
        field = integerFields[i];
        var intValue = parseInt(req.body[field], 10);
        if (isNaN(intValue) || intValue < 0) {
          sendError(res, 400, errors.INVALID_PARAMETERS,
                    "Invalid " + field + " number.");
          return;
        }
      }

      // Store room status for logging.
      req.roomStatusData = {};
      expectedFields.forEach(function (f) {
        req.roomStatusData[f] = req.body[f];
      });
    }

    next();
  }

  /**
   * Validates the given token exists and is valid.
   *
   * Once this is done, populates the:
   * - req.roomStorageData and
   * - req.token parameters with the appropriate values.
   **/
  function validateRoomToken(req, res, next) {
    req.token = req.params.token;
    storage.getRoomData(req.token, function(err, roomData) {
      if (res.serverError(err)) return;
      if (roomData === null) {
        sendError(res, 404, errors.INVALID_TOKEN, "Token not found.");
        return;
      }
      req.roomStorageData = roomData;
      next();
    });
  }

  /**
   * Checks the current connected hawk session is one of the room owner's one.
   **/
  function isRoomOwner(req, res, next) {
    if (req.user === req.roomStorageData.roomOwnerHmac) {
      next();
      return;
    }
    sendError(
      res, 403, errors.UNDEFINED,
      "Authenticated user is not the owner of this room."
    );
  }

  /**
   * Checks that the current user is either a room participant or a room
   * owner.
   **/
  function isRoomParticipant(req, res, next) {
    if (req.token === undefined) {
      throw new Error("req.token should be defined to use isRoomParticipant");
    }
    if (req.roomStorageData === undefined) {
      throw new Error("req.roomStorageData should be defined to use " +
                      "isRoomParticipant");
    }

    storage.getRoomParticipants(req.token, function(err, participants) {
      if (res.serverError(err)) return;

      var participantHmac = req.hawkIdHmac || req.participantTokenHmac;

      var isParticipant = participants.some(function(p) {
        return p.hawkIdHmac === participantHmac;
      });

      var isOwner = (req.user === req.roomStorageData.roomOwnerHmac);

      if (!isParticipant && !isOwner) {
        sendError(
          res, 403, errors.UNDEFINED,
          "Authenticated user is neither a participant of the room" +
          " nor the room owner."
        );
        return;
      }

      req.roomStorageData.participants = participants.map(function(participant) {
        delete participant.hawkIdHmac;
        return participant;
      });
      next();
    });
  }

  return {
    validateToken: validateToken,
    requireParams: requireParams,
    validateSimplePushURL: validateSimplePushURL,
    validateCallType: validateCallType,
    validateCallParams: validateCallParams,
    validateCallUrlParams: validateCallUrlParams,
    validateRoomParams: validateRoomParams,
    validateRoomStatusUpdate: validateRoomStatusUpdate,
    validateRoomToken: validateRoomToken,
    isRoomOwner: isRoomOwner,
    isRoomParticipant: isRoomParticipant
  };
};
