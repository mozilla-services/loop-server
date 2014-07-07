/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var expect = require("chai").expect;

function getMiddlewares(app, method, url) {
  return app.routes[method].filter(function(e){
    return e.path === url;
  }).shift().callbacks;
}

function intersection(array1, array2) {
  return array1.filter(function(n) {
    return array2.indexOf(n) !== -1;
  });
}

function expectFormatedError(res, code, errno, message) {
  expect(res.body).eql({
    code: code,
    errno: errno,
    error: message
  });
}

module.exports = {
  getMiddlewares: getMiddlewares,
  intersection: intersection,
  expectFormatedError: expectFormatedError
};
