/* jshint strict:false */

var express = require('express');
var tokenlib = require('./tokenlib');
var app = express();

app.use(express.json());
app.use(express.urlencoded());

var SECRET = "this is not a secret";

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

  var token = tokenlib.encode({}, SECRET);
  // XXX: use config to remove the hardcoded localhost
  return res.send(200, {call_url: "http://localhost/call/" + token});
});

app.listen(5000);

module.exports = app;

