/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var http = require('http');
var https = require('https');
var request = require('request');
var url = require('url');
var pagemetadata = require('../pagemetadata');

var async = require('async');

module.exports = function (app, conf) {
  // Configure http agents to use more than the default number of sockets.
  https.globalAgent.maxSockets = conf.get('maxHTTPSockets');
  http.globalAgent.maxSockets = conf.get('maxHTTPSockets');
  /**
   * Get remote url and return meta-data for the given url.
   **/

  app.get('/meta-data/:url',
    function(req, res) {
      // setup
      function finder(siteData, cb) {
        var serverURL = url.parse(siteData.url, false, true);
        var protocol = serverURL.protocol === 'wss:' ? 'https' :
          serverURL.protocol === 'ws:' ? 'http' : serverURL.protocol;
        var getUrl = url.format({
          protocol: protocol,
          host: serverURL.hostname,
          pathname: serverURL.pathname
        });

        request.get({
          url: getUrl,
          timeout: 30000, // conf.get('heartbeatTimeout'),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US; rv:1.8.1.13) Gecko/20080311 Firefox/2.0.0.13'
          }
        }, function(error, response) {
          if (error) {
            cb(error);
          }

          if (response && response.body) {
            siteData.body = response.body;
            cb(null, siteData);
          } else {
            cb(error);
          }
        });
      }

      function processor(siteData, cb) {
        var metaData = pagemetadata.getData(siteData.body, siteData.url);
        cb(null, metaData);
      }

      function formatter(metaData, cb) {
        var output = {};
        output.url = metaData.url ? metaData.url : null;
        output.docTitle = metaData.title ? metaData.title : null;
        output.description = metaData.description ? metaData.description : null;
        cb(null, metaData);
      }

      async.waterfall([
        function(cb){
          finder({ url: req.params.url }, cb);
        },
        function(siteData, cb) {
          processor(siteData, cb);
        },
        function(metaData, cb) {
          formatter(metaData, cb);
        },
        function(metaData) {
          res.status(200).json(metaData);
        }
      ]);
    }
  );
};
