/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";


module.exports = function (app, conf, logError, storage, auth, validators) {
  /**
   * Registers the given user with the given simple push url.
   **/
  app.post('/registration', auth.authenticate,
    validators.validateSimplePushURL, function(req, res) {
      storage.addUserSimplePushURLs(req.user, req.hawkIdHmac, req.simplePushURLs,
        function(err) {
          if (res.serverError(err)) return;
          res.status(200).json();
        });
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
