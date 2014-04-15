/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var strftime = require('strftime');

module.exports = function(req, res, next){
  var start =  new Date();
  res.on('finish', function() {
    var length = res._headers['content-length'] || "";
    var stop = new Date();

    console.log(
      '[%s] "%s %s HTTP/%s.%s" %s %s — (%s ms)',
      strftime("%B %d, %y %H:%M:%S", start),
      req.method, req.url, req.httpVersionMajor, req.httpVersionMinor,
      res.statusCode, length, stop - start);
  });
  next();
};
