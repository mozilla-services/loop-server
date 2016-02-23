/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var errors = require('../errno.json');
var sendError = require('../utils').sendError;
var ua = require('universal-analytics');


module.exports = function (app, conf, auth, validators) {
  /**
   * Delete an account and all data associated with it.
   **/
  app.post('/event', validators.requireParams('event', 'action', 'label'),
           auth.requireHawkSession, function(req, res) {
    if (conf.ga.activated) {
      var userAnalytics = ua(
        conf.ga.id, req.user,
        {strictCidFormat: false, https: true}
      );
      userAnalytics.event(
        req.body.event,
        req.body.action,
        req.body.label
      ).send();
      res.status(204).json({});
    } else {
      sendError(
        res, 405, errors.UNDEFINED,
        "Google Analytics events are not configured for this server."
      );
    }
  });
};
