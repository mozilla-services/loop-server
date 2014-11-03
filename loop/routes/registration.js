/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var errors = require("../errno.json");
var sendError = require('../utils').sendError;
var getSimplePushURLS = require('../utils').getSimplePushURLS;


module.exports = function (app, conf, logError, storage, auth, validators) {
  /**
   * Registers the given user with the given simple push url.
   **/
  app.post('/registration', auth.authenticate,
    function(req, res) {
      if (req.body !== undefined && !req.accepts("json")) {
        sendError(res, 406, errors.BADJSON,
                  "Request body should be defined as application/json");
        return;
      }

      getSimplePushURLS(req, function(err, simplePushURLs) {
        if (err) {
          sendError(res, 400, errors.INVALID_PARAMETERS, err.message);
          return;
        }
        if (Object.keys(simplePushURLs).length !== 0) {
          storage.addUserSimplePushURLs(req.user, req.hawkIdHmac, simplePushURLs,
            function(err) {
              if (res.serverError(err)) return;
          });
        }
      });

      res.status(200).json();
    });

  /**
   * Deletes the given simple push URL (you need to have registered it
   * to be able to unregister).
   **/
  app.delete('/registration', auth.requireHawkSession, function(req, res) {
    storage.removeSimplePushURLs(req.user, req.hawkIdHmac, function(err) {
      if (res.serverError(err)) return;
      res.status(204).json();
    });
  });
};
