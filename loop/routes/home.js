/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var loopPackageData = require('../../package.json');
var git = require('git-rev');
var request = require('request');

module.exports = function(app, conf, logError, storage, tokBox, statsdClient) {
  /**
   * Checks that the service and its dependencies are healthy.
   **/
  app.get("/__heartbeat__", function(req, res) {
    function returnStatus(storageStatus, requestError, pushStatus) {
      var status, message;
      if (storageStatus === true && requestError === null &&
          pushStatus !== false) {
        status = 200;
      } else {
        status = 503;
        if (requestError !== null) message = "TokBox " + requestError;
      }

      res.status(status)
         .json({
           storage: storageStatus === true,
           provider: (requestError === null) ? true : false,
           message: message,
           push: pushStatus
         });
    }

    storage.ping(function(storageStatus) {
      if (storageStatus !== true) {
        logError(storageStatus);
      }
      tokBox.ping({timeout: conf.get('heartbeatTimeout')},
        function(requestError) {
          // Setting pushStatus to undefined makes it not included in the json
          // response.
          var pushStatus;
          if (req.query.SP_LOCATION !== undefined) {
            request.put(req.query.SP_LOCATION, function(error, response) {
              if (error) console.error(req.query.SP_LOCATION, error);
              pushStatus = (!error && response.statusCode === 200);
              returnStatus(storageStatus, requestError, pushStatus);
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
          } else {
            returnStatus(storageStatus, requestError, pushStatus);
          }
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
