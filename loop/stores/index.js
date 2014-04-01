/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

function getStore(conf, options) {
  options = options || {};
  var Store = require('./' + conf.engine + '.js');
  return new Store(conf.settings, options);
}

module.exports = {getStore: getStore};
