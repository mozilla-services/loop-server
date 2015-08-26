/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var loopPackageData = require('../../package.json');
var git = require('git-rev');
var request = require('request');
var url = require('url');
var async = require('async');

function isSuccess(statusCode) {
  return statusCode === 200;
}

module.exports = function(app, conf, logError, storage, tokBox, statsdClient) {
  function pingPushServer(pushServerURI, callback) {
    var serverURL = url.parse(pushServerURI, false, true);
    var protocol = serverURL.protocol === 'wss:' ? 'https' :
      serverURL.protocol === 'ws:' ? 'http' : serverURL.protocol;
    request.get({
      url: url.format({
        protocol: protocol,
        host: serverURL.host,
        pathname: '/status'
      }),
      timeout: conf.get('heartbeatTimeout')
    }, function(error, response) {
      if (error) return callback(error);
      callback(null, response.statusCode);
    });
  }

  /**
   * Checks that the service and its dependencies are healthy.
   **/
  app.get("/__heartbeat__", function(req, res) {
    function returnStatus(storageStatus, tokboxError, pushStatus, verifierStatus) {
      var status, message;
      if (storageStatus === true && tokboxError === null &&
          pushStatus !== false && verifierStatus === true) {
        status = 200;
      } else {
        status = 503;
        if (tokboxError !== null) message = "TokBox " + tokboxError;
      }

      res.status(status)
         .json({
           storage: storageStatus === true,
           provider: (tokboxError === null) ? true : false,
           message: message,
           push: pushStatus,
           fxaVerifier: verifierStatus
         });
    }

    storage.ping(function(storageStatus) {
      if (storageStatus !== true) {
        logError(storageStatus);
      }
      tokBox.ping({timeout: conf.get('heartbeatTimeout')},
        function(tokboxError) {
          request.get({
            url: url.resolve(conf.get('fxaVerifier'), '/status'),
            timeout: conf.get('heartbeatTimeout')
          }, function(err, response) {
            var verifierStatus = !err && isSuccess(response.statusCode);
            var pushServerURIs = conf.get('pushServerURIs');
            async.map(pushServerURIs, pingPushServer, function(error, statusCodes) {
              if (error) logError(error);
              var pushStatus = (!error && statusCodes.every(isSuccess));
              returnStatus(storageStatus, tokboxError, pushStatus, verifierStatus);
              if (statsdClient !== undefined) {
                statsdClient.count('loop.simplepush.call', 1);
                var counter_push_status_counter;
                if (pushStatus) {
                  counter_push_status_counter = 'loop.simplepush.call.heartbeat.success';
                } else {
                  counter_push_status_counter = 'loop.simplepush.call.heartbeat.failures';
                }
                statsdClient.count(counter_push_status_counter, 1);
              }
            });
          });
        });
    });
  });

  /**
   * Displays some version information at the root of the service.
   **/
  app.get("/", function(req, res) {
    var metadata = {
      name: loopPackageData.name,
      description: loopPackageData.description,
      version: loopPackageData.version,
      homepage: loopPackageData.homepage,
      endpoint: conf.get("protocol") + "://" + req.get('host')
    };

    // Adding information about the tokbox backend
    metadata.fakeTokBox = conf.get('fakeTokBox');
    metadata.fxaOAuth = conf.get('fxaOAuth').activated;

    // Adding localization information for the client.
    metadata.i18n = {
      defaultLang: conf.get("i18n").defaultLang
    };

    if (req.headers["accept-language"]) {
      metadata.i18n.lang = req.headers["accept-language"].split(",")[0];
    }

    if (!conf.get("displayVersion")) {
      delete metadata.version;
    }

    // Adding revision if available
    git.long(function (commitId) {
      if (commitId) {
        metadata.rev = commitId;
      }
      git.branch(function (branch) {
        if (branch) {
          metadata.branch = branch;
        }

        res.status(200).json(metadata);
      });
    });
  });
};
