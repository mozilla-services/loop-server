/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";


module.exports = function (app, storage, auth) {
  /**
   * Delete an account and all data associated with it.
   **/
  app.delete('/account', auth.requireHawkSession, function(req, res) {
    storage.deleteUserSimplePushURLs(req.user, function(err) {
      if (res.serverError(err)) return;
      storage.deleteUserCallUrls(req.user, function(err) {
        if (res.serverError(err)) return;
        storage.deleteUserCalls(req.user, function(err) {
          if (res.serverError(err)) return;
          storage.deleteHawkUserId(req.hawkIdHmac, function(err) {
            if (res.serverError(err)) return;
            storage.deleteHawkSession(req.hawkIdHmac, function(err) {
              if (res.serverError(err)) return;
              res.status(204).json();
            });
          });
        });
      });
    });
  });
};
