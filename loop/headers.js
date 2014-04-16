/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var conf = require("./config").conf;

module.exports = function headersMiddleware(req, res, next){
  res.once('header', function() {
    if (res.statusCode === 200 || res.statusCode === 401) {
      res.setHeader('Timestamp', new Date().getTime());
    }

    if (res.statusCode === 503) {
      res.setHeader('Retry-After', conf.get('retryAfter'));
    }
  });
  next();
};
