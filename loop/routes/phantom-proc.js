/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var http = require('http');
var https = require('https');
var url = require('url');

var execFile = require('child_process').execFile;
var validateUrl = require('valid-url');

function _validateURL(uri) {
  var re = /[^A-Za-z0-9&://#?+=\-._~]/g;   //remove spaces also
  var sanitizedUrl = uri.replace(re,'');
  uri = null;

  try {
    var serverURL = url.parse(sanitizedUrl.trim(), false, true);
    serverURL.protocol = serverURL.protocol.toLowerCase();
    var protocol = serverURL.protocol === 'wss:' ? 'https:' :
      serverURL.protocol === 'ws:' ? 'http:' : serverURL.protocol;
    console.log("protocol", protocol);
    if (["http:", "https:"].indexOf(protocol) < 0) {
      return null;
    }
    var getUrl = url.format({
      protocol: protocol,
      host: serverURL.hostname,
      port: serverURL.port,
      pathname: serverURL.pathname,
      search: serverURL.search,
      hash: serverURL.hash
    });
    var getHost = url.format({
      protocol: protocol,
      host: serverURL.hostname,
      port: serverURL.port
    });
    
    var validURL = url.resolve(getHost, getUrl);

    if (validateUrl.isUri(validURL)){
      return validURL;
    } else {
      return null;
    }
  } catch (ex) {
    // URL may throw, default to null;
    console.log("URL not valid error", ex);
    return null;
  }
}

module.exports = function (app, conf) {
  // Configure http agents to use more than the default number of sockets.
  https.globalAgent.maxSockets = conf.get('maxHTTPSockets');
  http.globalAgent.maxSockets = conf.get('maxHTTPSockets');
  /**
   * Get return web page for the given url and rasterize.
   **/
  app.get('/phantom-proc/:url',
    function(req, res) {
      // setup
      var validUrl = _validateURL(decodeURIComponent(req.query.url.trim()));
      if (validUrl){
        var argObj = "{\"url\":\"" + validUrl + "\",\"window\":{\"width\": 216, \"height\": 130}, \"zoom\":{\"factor\": 0.2}}";
        execFile('phantomjs', ['--disk-cache=true', '--ignore-ssl-errors=true', '--web-security=false', './loop/render.js', argObj], function (err, result) {
          if (err) {
            return;
          }
          res.status(200).json(result);
        });
      } else {
        res.status(200).json("Not an URI.");
      }
    }
  );
};
