/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var express = require('express');
var tokenlib = require('./tokenlib');
var conf = require('./config.js');
var app = express();

app.use(express.json());
app.use(express.urlencoded());

var tokenManager = new tokenlib.TokenManager(conf.get('tokenSecret'));

function validateCallUrl(reqDataObj) {
  if (typeof reqDataObj !== 'object')
    throw new Error('missing request data');

  if (!reqDataObj.hasOwnProperty('simple_push_url'))
    throw new Error('simple_push_url is required');

  if (reqDataObj.simple_push_url.indexOf('http') !== 0)
    throw new Error('simple_push_url should be a valid url');

  return reqDataObj;
}

app.post('/call-url', function(req, res) {
  var validated;

  if (req.headers['content-type'] !== 'application/json')
    return res.json(406, ['application/json']);

  try {
    validated = validateCallUrl(req.body);
  } catch (err) {
    return res.json(400, {error: err.message});
  }

  var token = tokenManager.encode({}, conf.get('tokenSecret'));
  var host = req.protocol + "://" + req.get('host');
  return res.send(200, {call_url: host + "/call/" + token});
});

app.listen(conf.get('port'), conf.get('host'));

module.exports = app;

