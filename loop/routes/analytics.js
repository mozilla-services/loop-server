/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var errors = require('../errno.json');
var sendError = require('../utils').sendError;

exports.sendAnalytics = require('../utils').sendAnalytics;

exports.analytics = function (app, conf, auth, validators) {
  /**
   * Delete an account and all data associated with it.
   **/
  app.post('/event', validators.requireParams('event', 'action', 'label'),
           auth.requireHawkSession, function(req, res) {
    var ga = conf.get("ga");
    if (ga.activated) {
      module.exports.sendAnalytics(ga.id, req.user, req.body);
      res.status(204).json({});
    } else {
      sendError(
        res, 405, errors.UNDEFINED,
        "Google Analytics events are not configured for this server."
      );
    }
  });
};
