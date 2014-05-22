"use strict";

var Hawk = require('hawk');
var Token = require("./token").Token;


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
 * The ways to get/create the session are not defined inside this function
 * because we want to let this up to the server implementer.
 */
function getMiddleware(getSession, createSession) {

  function requireSession(req, res, next) {
    Hawk.server.authenticate(req, function(id, callback) {
      getSession(id, callback);
    }, {},
      function(err, credentials, artifacts) {
        req.hawk = artifacts;

        if (err && err.isMissing) {
          // logError(err, artifacts);

          if (createSession !== undefined) {
            var token = new Token();
            token.getCredentials(function(tokenId, authKey, sessionToken) {
              createSession(tokenId, authKey, function(err) {
                if (err) {
                  res.json(503, "Service Unavailable");
                  return;
                }

                // If we have a session available, add it to headers so that
                // it's easy to plug this middlware with already existing
                // requests.
                // XXX. Pass a sendSession parameter to the function
                // optionally.
                req.user = tokenId;
                res.setHeader('Hawk-Session-Token', sessionToken);
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

        if (credentials === null) {
          res.json(403, "Forbidden");
          return;
        }
        req.user = req.hawk.id;

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
          res.setHeader("Server-Authorization", header);
          writeHead.apply(res, arguments);
        };
        next();
      });
  }
  return requireSession;
}

module.exports = {
  getMiddleware: getMiddleware 
};
