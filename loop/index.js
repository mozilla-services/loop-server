/* jshint strict:false */
var env = process.env.NODE_ENV || "development";
var config = require('../config/' + env + '.js');

var express = require('express');
var app = express();

app.use(express.json());
app.use(express.urlencoded());

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

  return res.json(200, {validated: validated}); // XXX to be continued
});

app.listen(5000);

module.exports = app;
