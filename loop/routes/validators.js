/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var errors = require("../errno.json");
var sendError = require('../utils').sendError;
var tokenlib = require('../tokenlib');


module.exports = function(conf, logError, storage) {
  /**
   * Middleware that validates the given token is valid (should be included into
   * the "token" parameter.
   **/
  function validateToken(req, res, next) {
    req.token = req.param('token');
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

      // Bug 1032966 - Handle old simple_push_url format
      if (params.indexOf("simplePushURL") !== -1) {
        if (req.body.hasOwnProperty("simple_push_url")) {
          req.body.simplePushURL = req.body.simple_push_url;
          delete req.body.simple_push_url;
        }
      }

      missingParams = params.filter(function(param) {
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
    requireParams("simplePushURL")(req, res, function() {
      req.simplePushURL = req.body.simplePushURL;
      if (req.simplePushURL.indexOf('http') !== 0) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "simplePushURL should be a valid url");
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
    var expiresIn = conf.get('callUrlTimeout'),
        maxTimeout = conf.get('callUrlMaxTimeout');

    if (req.body.hasOwnProperty("expiresIn")) {
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
      req.token = tokenlib.generateToken(conf.get("callUrlTokenSize"));
    }

    req.urlData = {
      userMac: req.user,
      callerId: req.body.callerId,
      timestamp: parseInt(Date.now() / 1000, 10),
      issuer: req.body.issuer || ''
    };

    if (expiresIn !== undefined) {
      req.urlData.expires = req.urlData.timestamp +
                            expiresIn * tokenlib.ONE_HOUR;
    }
    next();
  }

  return {
    validateToken: validateToken,
    requireParams: requireParams,
    validateSimplePushURL: validateSimplePushURL,
    validateCallType: validateCallType,
    validateCallUrlParams: validateCallUrlParams
  };
};
