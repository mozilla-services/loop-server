/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var errors = require('../errno');
var sendError = require('../utils').sendError;

module.exports = function (app, conf, logError, storage, auth, validators) {
    /**
     * Return the list of existing call-urls for this specific user.
     **/
    app.get('/call-url', auth.requireHawkSession, function(req, res) {
      storage.getUserCallUrls(req.user, function(err, urls) {
        if (res.serverError(err)) return;
        var callUrlsData = urls.map(function(url) {
          delete url.userMac;
          return url;
        });
        res.status(200).json(callUrlsData);
      });
    });

    /**
     * Generates and return a call-url for the given callerId.
     **/
    app.post('/call-url', auth.requireHawkSession,
      function(req, res) {
        // The call-url endpoint is now deprecated.
        sendError(res, 405, errors.NO_LONGER_SUPPORTED, "No longer supported");
        return;
      });

    app.put('/call-url/:token', auth.requireHawkSession,
      validators.validateToken, validators.validateCallUrlParams,
      function(req, res) {
        storage.updateUserCallUrlData(req.user, req.token, req.urlData,
          function(err) {
            if (err && err.notFound === true) {
              sendError(res, 404, errors.INVALID_TOKEN, "Not Found.");
              return;
            }
            else if (res.serverError(err)) return;

            res.status(200).json({
              expiresAt: req.urlData.expires
            });
          });
      });

    /**
     * Revoke a given call url.
     **/
    app.delete('/call-url/:token', auth.requireHawkSession,
      validators.validateToken, function(req, res) {
        if (req.callUrlData.userMac !== req.user) {
          sendError(res, 403, errors.INVALID_AUTH_TOKEN, "Forbidden");
          return;
        }
        storage.revokeURLToken(req.token, function(err) {
          if (res.serverError(err)) return;
          res.status(204).json();
        });
      });
  };
