/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var hawk = require('express-hawkauth');

var encrypt = require("./encrypt").encrypt;
var errors = require('./errno.json');
var hmac = require('./hmac');
var sendError = require('./utils').sendError;
var fxa = require('./fxa');


module.exports = function(conf, logError, storage, statsdClient) {
  var hawkOptions = {
    port: conf.get("protocol") === "https" ? 443 : undefined
  };

  /**
   * Attach the identity of the user to the request if she is registered in the
   * database.
   **/
  function setUser(req, res, credentials, done) {
    req.hawkIdHmac = hmac(credentials.id, conf.get("hawkIdSecret"));
    storage.getHawkUser(req.hawkIdHmac, function(err, user) {
      if (res.serverError(err)) return;

      storage.touchHawkSession(req.hawkIdHmac);
      // If an identity is defined for this hawk session, use it.
      if (user !== null) {
        req.user = user;
        done();
        return;
      }
      req.user = req.hawkIdHmac;
      done();
    });
  }

  function getHawkSession(tokenId, callback) {
    storage.getHawkSession(hmac(tokenId, conf.get("hawkIdSecret")), callback);
  }

  function createHawkSession(tokenId, authKey, callback) {
    var hawkIdHmac = hmac(tokenId, conf.get("hawkIdSecret"));
    storage.setHawkSession(hawkIdHmac, authKey, function(err) {
      if (statsdClient && err === null) {
        statsdClient.count('loop-activated-users', 1);
      }
      callback(err);
    });
  }

  function hawkSendError(res, status, payload) {
    var errno = errors.INVALID_AUTH_TOKEN;
    if (status === 503) {
      errno = errors.BACKEND;
    }
    sendError(res, status, errno, payload);
  }

  /**
   * Middleware that requires a valid hawk session.
   **/
  var requireHawkSession = hawk.getMiddleware({
    hawkOptions: hawkOptions,
    getSession: getHawkSession,
    setUser: setUser,
    sendError: hawkSendError
  });

  /**
   * Middleware that uses a valid hawk session or create one if none already
   * exist.
   **/
  var attachOrCreateHawkSession = hawk.getMiddleware({
    hawkOptions: hawkOptions,
    getSession: getHawkSession,
    createSession: createHawkSession,
    setUser: setUser,
    sendError: hawkSendError
  });

  /**
   * Middleware that reject all provided hawk session and always create
   * a new one.
   **/
  var createAndAttachHawkSession = hawk.getMiddleware({
    hawkOptions: hawkOptions,
    getSession: function(tokenId, callback) { callback(null, null); },
    createSession: createHawkSession,
    setUser: setUser,
    sendError: hawkSendError
  });

  /**
   * Middleware that requires a valid FxA assertion.
   *
   * In case of success, return an hawk session token in the headers.
   **/
  var requireFxA = fxa.getMiddleware({
      audiences: conf.get('fxaAudiences'),
      trustedIssuers: conf.get('fxaTrustedIssuers')
    },
    function(req, res, assertion, next) {
      var idpClaims = assertion.idpClaims;

      var identifier = idpClaims['fxa-verifiedEmail'] ||
                       idpClaims.verifiedMSISDN;

      if (identifier === undefined) {
        logError(new Error("Assertion is invalid: " + assertion));
        sendError(res, 400, errors.INVALID_AUTH_TOKEN,
                  "BrowserID assertion is invalid");
        return;
      }

      var userHmac = hmac(identifier, conf.get('userMacSecret'));

      // generate the hawk session.
      hawk.generateHawkSession(createHawkSession,
        function(err, tokenId, authKey, sessionToken) {
          if (res.serverError(err)) return;
          var hawkIdHmac = hmac(tokenId, conf.get("hawkIdSecret"));
          var encryptedIdentifier = encrypt(tokenId, identifier);
          storage.setHawkUser(userHmac, hawkIdHmac, function(err) {
            if (res.serverError(err)) return;
            storage.setHawkUserId(hawkIdHmac, encryptedIdentifier,
              function(err) {
                if (res.serverError(err)) return;

                // return hawk credentials.
                hawk.setHawkHeaders(res, sessionToken);
                req.user = userHmac;
                next();
              });
          });
        }
      );
    }
  );

  /**
   * Middleware that requires either BrowserID, Hawk, or nothing.
   *
   * In case no authenticate scheme is provided, creates and return a new hawk
   * session.
   **/
  function authenticate(req, res, next) {
    var supported = ["BrowserID", "Hawk"];

    // First thing: check that the headers are valid. Otherwise 401.
    var authorization = req.headers.authorization;

    function _unauthorized(message, supported) {
      res.set('WWW-Authenticate', supported.join());
      sendError(res, 401, errors.INVALID_AUTH_TOKEN, message || "Unauthorized");
    }

    if (authorization !== undefined) {
      var splitted = authorization.split(" ");
      var policy = splitted[0];

      // Next, let's check which one the user wants to use.
      if (supported.map(function(s) { return s.toLowerCase(); })
          .indexOf(policy.toLowerCase()) === -1) {
        _unauthorized("Unsupported", supported);
        return;
      }

      if (policy.toLowerCase() === "browserid") {
        // If that's BrowserID, then check and create hawk credentials, plus
        // return them.
        requireFxA(req, res, next);
      } else if (policy.toLowerCase() === "hawk") {
        // If that's Hawk, let's check they're valid.
        requireHawkSession(req, res, next);
      }
    } else {
      // unauthenticated.
      attachOrCreateHawkSession(req, res, next);
    }
  }

  return {
    authenticate: authenticate,
    requireHawkSession: requireHawkSession,
    attachOrCreateHawkSession: attachOrCreateHawkSession,
    createAndAttachHawkSession: createAndAttachHawkSession,
    requireFxA: requireFxA
  };
};
