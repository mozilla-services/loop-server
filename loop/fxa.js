/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var https = require('https');
var request = require('request');
var conf = require('./config').conf;
var atob = require('atob');
var sendError = require("./utils").sendError;
var errors = require("./errno.json");

// Don't be limited by the default node.js HTTP agent.
var agent = new https.Agent();
agent.maxSockets = 1000000;

/**
 * Helper function. Get the audience from the given assertion.
 *
 * @param {String} assertion The assertion to unpack
 *
 * @return {Object} the audience of this assertion.
 */
exports.getAssertionAudience = function(assertion) {
  var parts = assertion.split('.');
  return JSON.parse(atob(parts[3])).aud;
};

/**
 * Verifies that the assertion is a valid one, given an audience and a set of
 * trusted issuers.
 *
 * @param {String} assertion, Assertion to check the validity of.
 * @param {String} audience, Audience of the given assertion.
 * @param {Array} trustedIssuers, A list of trusted issuers.
 * @param {Function} callback, a callback that's given the validated assertion.
 * Signature is (err, assertion);
 **/
function verifyAssertion(assertion, audiences, trustedIssuers, callback) {
  // ensure audiences is an array.
  if (Object.prototype.toString.call(audiences) !== '[object Array]' ) {
    throw new Error("The 'audiences' parameter should be an array");
  }
  var assertionAudience = exports.getAssertionAudience(assertion);
  var audience;

  // Check we trust the audience of the assertion.
  var trustedAudienceIndex = audiences.indexOf(assertionAudience);
  if (trustedAudienceIndex !== -1) {
    audience = audiences[trustedAudienceIndex];
  } else {
    callback("Invalid audience");
  }

  request.post({
    uri: conf.get('fxaVerifier'),
    json: {
      audience: audience,
      assertion: assertion
    }
  }, function(err, message, data) {
    if (err) {
      callback(err);
      return;
    }
    // Check the issuer is trusted.
    if (data.status !== "okay") {
      callback(data.reason);
      return;
    }
    if (trustedIssuers.indexOf(data.issuer) === -1) {
      callback("Issuer is not trusted");
      return;
    }
    callback(null, data);
  });
}


/**
 * Express middleware doing BrowserID authentication.
 *
 * Checks the Authorization headers are set properly, and if not return
 * a 401 with according information.
 *
 * If the BrowserID assertion is parsed correctly, the user contained into this
 * one is set in the req.user property.
 */
function getMiddleware(conf, callback) {
  function requireBrowserID(req, res, next) {
    var authorization, assertion, policy, splitted;

    function _unauthorized(message){
      res.set('WWW-Authenticate', 'BrowserID');
      sendError(res, 401, errors.INVALID_AUTH_TOKEN, message || "Unauthorized");
    }

    authorization = req.headers.authorization;

    if (authorization === undefined) {
      _unauthorized();
      return;
    }

    splitted = authorization.split(" ");
    if (splitted.length !== 2) {
      _unauthorized();
      return;
    }

    policy = splitted[0];
    assertion = splitted[1];

    if (policy.toLowerCase() !== 'browserid') {
      _unauthorized("Unsupported");
      return;
    }

    module.exports.verifyAssertion(
      assertion, conf.audiences, conf.trustedIssuers,
      function(err, data) {
        if (err) {
          _unauthorized(err);
          return;
        }
        callback(req, res, data, next);
      });
  }

  return requireBrowserID;
}

exports.getMiddleware = getMiddleware;
exports.verifyAssertion = verifyAssertion;
exports.request = request;
