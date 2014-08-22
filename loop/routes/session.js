/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

module.exports = function (app, auth) {

  /**
   * An endpoint you can use to retrieve a hawk session.
   *
   * In the case of OAuth, this session will be upgraded at the end of the
   * authentication flow, with an attached identity.
   **/
  app.post('/session', auth.attachOrCreateHawkSession, function(req, res) {
    res.status(204).json();
  });
};
