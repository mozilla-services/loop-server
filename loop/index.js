/* jshint strict:false */

var express = require('express');
var app = express();

app.use(express.json());
app.use(express.urlencoded());

app.post('/call-url', function(req, res) {
  if (req.headers['content-type'] !== 'application/json')
    return res.json(406, ['application/json']);

  // XXX this is never reached in case of empty request body sent, investigate
  if (typeof req.body !== 'object')
    return res.json(400, {error: 'missing request data'});

  if (!req.body.hasOwnProperty('simple_push_url'))
    return res.json(400, {error: 'simple_push_url is required'});

  if (req.body.simple_push_url.indexOf('http') !== 0)
    return res.json(400, {error: 'simple_push_url should be a valid url'});

  return res.json(200, {ok: true}); // XXX to be continued
});

app.listen(5000);

module.exports = app;
