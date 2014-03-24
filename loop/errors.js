/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

/**
 * The "errors" middleware adds two functions to the response object in order
 * to handle validation.
 *
 * - "addError" adds a new validation error to the response. Should be followed
 *   by "sendError()" in order to send the response.
 * - "sendError" adds a new validation error and sends the response right
 *   after. Response will be a `400 BAD REQUEST` JSON response.
 *
 * @param {String} location     Location where the parameter had been looked
 *                              for. Should be one of "header", "body", "url"
 *                              or "querystring".
 * @param {String} name         Name of the faulty parameter.
 * @param {String} description  Description of the error.
 *
 * You can use directly "sendError" without any parameters to trigger the
 * response.
 **/
function errorsMiddleware(req, res, next) {
  var errors = [];
  res.addError = function(location, name, description) {
    if (["body", "header", "url", "querystring"].indexOf(location) === -1) {
      throw new Error('"' + location + '" is not a valid location. ' +
                      'Should be one of "header", "body", "url" or ' +
                      '"querystring".');
    }
    errors.push({
      location: location,
      name: name,
      description: description
    });
  };
  res.sendError = function(location, name, description) {
    if (typeof location !== "undefined") {
      res.addError(location, name, description);
    }
    res.json(400, {status: "errors", errors: errors});
  };
  next();
}


module.exports = errorsMiddleware;
