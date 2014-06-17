/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

module.exports = function getMiddleware(logError) {
  return function UnavailableErrorMiddleware(req, res, next) {
    res.error = function raiseError(error) {
      if (error) {
        logError(error);
        res.json(503, "Service Unavailable");
        return true;
      }
      return false;
    };
    
    next();
  };
};
