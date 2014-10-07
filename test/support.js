/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var expect = require("chai").expect;

function getMiddlewares(app, method, url) {
  var apiRouter;
  if (app.hasOwnProperty("_router")) {
    apiRouter = app._router;
  } else {
    apiRouter = app;
  }

  var methodStack = apiRouter.stack.filter(function(e) {
    if (e.route && e.route.path === url &&
        e.route.methods[method]) {
      return true;
    }
    return false;
  }).shift();

  return methodStack.route.stack.map(function(e) {
    return e.handle;
  });
}

function intersection(array1, array2) {
  return array1.filter(function(n) {
    return array2.indexOf(n) !== -1;
  });
}

function expectFormattedError(res, code, errno, message) {
  expect(res.body).eql({
    code: code,
    errno: errno,
    error: message
  });
}

module.exports = {
  getMiddlewares: getMiddlewares,
  intersection: intersection,
  expectFormattedError: expectFormattedError
};
