/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var Hawk = require('hawk');
var Url = require('url');

var Token = require("./token").Token;

/**
 * Generate and store an hawk session. Storage is not handled by this function
 * directly, but by the storeSession callback passed as a first argument.
 *
 * @param {Function} storeSession, This function knows how to store a new
 * session. Implementation specifics are out of the scope of this module. The
 * function signature is (tokenId, authKey, callback). Callback is triggered
 * when the storage had been done (or can contain errors, passed as the first
 * argument).
 *
 * @param {Function} callback, a callback that's given the information about
 * the generated token. Signature is (err, tokenId, authKey, sessionToken).
 *
 **/
function generateHawkSession(storeSession, callback) {
  var token = new Token();
  token.getCredentials(function(tokenId, authKey, sessionToken) {
    storeSession(tokenId, authKey, function(err) {
      callback(err, tokenId, authKey, sessionToken);
    });
  });
}

/**
 * Sets the hawk headers in the given response.
 **/
function setHawkHeaders(res, sessionToken) {
  res.setHeader('Hawk-Session-Token', sessionToken);
  res.setHeader('Access-Control-Expose-Headers', 'Hawk-Session-Token');
}


/**
 * Hawk middleware factory.
 *
 * Returns a function that could be used as a middleware, to check an hawk
 * session exists and is valid.
 *
 * The middleware checks that the request is authenticated with hawk, and sign
 * the response.
 *
 * @param {Function} getSession, A function that knows where to find the
 * session. The function should take two arguments: the identifier of the
 * session and a callback argument.
 *
 * The callback is called when the search operation had been finished.
 * Signature is (error, options). "options" being a javascript object with
 * a "key" key and an "algorithm" one. Example:
 *
 *    callback(null, {
 *      key: result,
 *      algorithm: "sha256"
 *    });
 *
 * In case the record doesn't exist, you can call callback(null, null);
 *
 * @param {Function} createSession, **If defined, a new session will be created
 * if no valid session was found**. This function knows how to store a new
 * session. Implementation specifics are out of the scope of this module. The
 * function signature is (tokenId, authKey, callback). Callback is triggered
 * when the storage had been done (or can contain errors, passed as the first
 * argument).
 *
 * @param {Function} setUser, a callback function that's being passed the
 * request, the response and the hawk id.
 *
 * The ways to get/create the session are not defined inside this function
 * because we want to let this up to the server implementer.
 */
function getMiddleware(getSession, createSession, setUser) {
  if (setUser === undefined) {
    setUser = createSession;
    createSession = undefined;
  }

  function requireSession(req, res, next) {
    // Required as the clients stripe out the querystrings…
    req.url = Url.parse(req.url).pathname;
    Hawk.server.authenticate(req, function(id, callback) {
      getSession(id, callback);
    }, {},
      function(err, credentials, artifacts) {
        req.hawk = artifacts;

        if (err) {
          if (err.isMissing) {
            if (createSession !== undefined) {
              generateHawkSession(createSession,
              function(err, tokenId, authKey, sessionToken) {
                if (err) {
                  res.json(503, "Service Unavailable");
                  return;
                }

                setUser(req, res, tokenId, function() {
                  setHawkHeaders(res, sessionToken);
                  next();
                });
              });
              return;
            } else {
              // In case no supported authentication was specified (and we
              // don't need to create the session),  challenge the client.
              res.setHeader("WWW-Authenticate",
                            err.output.headers["WWW-Authenticate"]);
              res.json(401, err.output.payload);
              return;
            }
          }
          if (err.isBoom === true) {
            if (err.output.headers) {
              for (var header in err.output.headers) {
                res.set(header, err.output.headers[header]);
              }
            }
            res.json(err.output.statusCode, err.output.message);
            return;
          }
        }

        if (credentials === null) {
          res.setHeader("WWW-Authenticate", "Hawk");
          res.json(401, "Unauthorized");
          return;
        }
        setUser(req, res, req.hawk.id, function() {
          /* Make sure we don't decorate the writeHead more than one time. */
          if (res._hawkEnabled) {
            next();
            return;
          }

          var writeHead = res.writeHead;
          res._hawkEnabled = true;
          res.writeHead = function hawkWriteHead() {
            var header = Hawk.server.header(
              credentials, artifacts, {
                payload: res.body,
                contentType: res.get('Content-Type')
              });
            // The server signs its responses so the client can check they're
            // coming from there.
            res.setHeader("Server-Authorization", header);
            writeHead.apply(res, arguments);
          };
          next();
        });
      });
  }
  return requireSession;
}

module.exports = {
  getMiddleware: getMiddleware,
  generateHawkSession: generateHawkSession,
  setHawkHeaders: setHawkHeaders
};
