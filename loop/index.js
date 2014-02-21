"use strict";

var express = require('express');
var app = express();
app.use(express.json());

app.post('/call-url', function(req, res){
  req.accepts('json');
  if (!('simple_push_url' in req.body)){
    return res.json(400, {error: 'simple_push_url is required'});
  }
  console.log(req.body);
});

app.listen(5000);

module.exports = app;
