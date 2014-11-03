/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";


module.exports = function (app, conf, storage, auth) {
  /**
   * Removes the connected user session and drop its simplePushUrls and
   * Hawk session.
   **/
  app.delete('/session', auth.requireRegisteredUser,
    function(req, res) {
      storage.removeSimplePushURLs(req.user, req.hawkIdHmac, function(err) {
        if (res.serverError(err)) return;
        storage.deleteHawkSession(req.hawkIdHmac, function(err) {
          if (res.serverError(err)) return;
          res.status(204).json();
        } );
      });
  });

};
