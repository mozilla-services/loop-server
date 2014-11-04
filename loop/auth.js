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


  function unauthorized(res, supported, message) {
    var header = supported.join();
    if (message) {
      header += ' error="' + message.replace(/"/g, '\"') + '"';
    }
    res.set('WWW-Authenticate', header);
    sendError(res, 401, errors.INVALID_AUTH_TOKEN, message || "Unauthorized");
  }


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

  function getOAuthHawkSession(tokenId, callback) {
    var hawkIdHmac = hmac(tokenId, conf.get("hawkIdSecret"));
    storage.getHawkOAuthState(hawkIdHmac, function(err, state) {
      if (err) {
        callback(err);
        return;
      }
      if (state === null) {
        // This means it is not an OAuth session
        callback(null, null);
        return;
      }
      storage.getHawkSession(hawkIdHmac, callback);
    });
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

  var requireRegisteredUser = function(req, res, next) {
    storage.getHawkUser(req.hawkIdHmac, function(err, user) {
      if (res.serverError(err)) return;
      if (user === null) {
        sendError(res, 403, errors.INVALID_AUTH_TOKEN,
                 "You should be a registered user to perform this action.");
        return;
      }
      next();
    });
  };

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
   * Middleware that requires a valid OAuth hawk session.
   **/
  var requireOAuthHawkSession = hawk.getMiddleware({
    hawkOptions: hawkOptions,
    getSession: getOAuthHawkSession,
    setUser: setUser,
    sendError: hawkSendError
  });

  /**
   * Middleware that uses a valid OAuth hawk session or create one if none already
   * exist.
   **/
  var attachOrCreateOAuthHawkSession = hawk.getMiddleware({
    hawkOptions: hawkOptions,
    getSession: getOAuthHawkSession,
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
                req.hawkIdHmac = hawkIdHmac;
                req.user = userHmac;
                next();
              });
          });
        }
      );
    }
  );


  function requireBasicAuthToken(req, res, next) {
    var authorization, policy, splitted, token;

    authorization = req.headers.authorization;

    if (authorization === undefined) {
      unauthorized(res, ["Basic"]);
      return;
    }

    splitted = authorization.split(" ");
    if (splitted.length !== 2) {
      unauthorized(res, ["Basic"]);
      return;
    }

    policy = splitted[0];
    token = new Buffer(splitted[1], 'base64').toString().replace(/:$/g, '');

    if (policy.toLowerCase() !== 'basic') {
      unauthorized(res, ["Basic"], "Unsupported");
      return;
    }

    var tokenHmac = hmac(token, conf.get('userMacSecret'));

    // req.token is the roomToken, tokenHmac is the user authentication token.
    storage.isValidRoomToken(req.token, tokenHmac, function(err, isValid) {
      if (res.serverError(err)) return;
      if (!isValid) {
        unauthorized(res, ["Basic"], "Invalid token; it may have expired.");
        return;
      }
      req.participantTokenHmac = tokenHmac;
      next();
    });
  }

  /**
   * Middleware that requires either BrowserID, Hawk, or nothing.
   *
   * In case no authenticate scheme is provided, creates and return a new hawk
   * session.
   **/

  function getAuthenticate(supported, resolve, reject) {
    return function authenticate(req, res, next) {
      // First thing: check that the headers are valid. Otherwise 401.
      var authorization = req.headers.authorization;

      if (authorization !== undefined) {
        var splitted = authorization.split(" ");
        var policy = splitted[0];

        // Next, let's check which one the user wants to use.
        if (supported.map(function(s) { return s.toLowerCase(); })
            .indexOf(policy.toLowerCase()) === -1) {
          unauthorized(res, supported, "Unsupported");
          return;
        }

        resolve(policy, req, res, next);
      } else {
        if (reject !== undefined) {
          // Handle unauthenticated.
          reject(req, res, next);
        } else {
          // Accept unauthenticated
          next();
        }
      }
    };
  }

  var authenticate = getAuthenticate(["BrowserID", "Hawk"],
    function(policy, req, res, next) {
      if (policy.toLowerCase() === "browserid") {
        // If that's BrowserID, then check and create hawk credentials, plus
        // return them.
        requireFxA(req, res, next);
      } else if (policy.toLowerCase() === "hawk") {
        // If that's Hawk, let's check they're valid.
        requireHawkSession(req, res, next);
      }
    }, function(req, res, next) {
      // If unauthenticated create a new Hawk Session
      attachOrCreateHawkSession(req, res, next);
    });

  var authenticateWithHawkOrToken = getAuthenticate(["Basic", "Hawk"],
    function(policy, req, res, next) {
      if (policy.toLowerCase() === "basic") {
        // If that's Basic, then check if the token is right
        requireBasicAuthToken(req, res, next);
      } else if (policy.toLowerCase() === "hawk") {
        // If that's Hawk, let's check they're valid.
        requireHawkSession(req, res, next);
      }
    });

  return {
    authenticate: authenticate,
    authenticateWithHawkOrToken: authenticateWithHawkOrToken,
    requireHawkSession: requireHawkSession,
    attachOrCreateHawkSession: attachOrCreateHawkSession,
    requireOAuthHawkSession: requireOAuthHawkSession,
    attachOrCreateOAuthHawkSession: attachOrCreateOAuthHawkSession,
    requireFxA: requireFxA,
    requireRegisteredUser: requireRegisteredUser,
    requireBasicAuthToken: requireBasicAuthToken,
    unauthorized: unauthorized
  };
};
