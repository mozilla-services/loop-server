/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

function getFileStorage(conf, options) {
  var engine = conf.engine || 'filesystem';
  var settings = conf.settings || {};

  var Storage = require('./' + engine + '.js');
  return new Storage(settings, options);
}

module.exports = getFileStorage;
