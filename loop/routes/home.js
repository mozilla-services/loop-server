/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var loopPackageData = require('../../package.json');


module.exports = function(app, conf, logError, storage, tokBox) {
  /**
   * Checks that the service and its dependencies are healthy.
   **/
  app.get("/__heartbeat__", function(req, res) {
    storage.ping(function(storageStatus) {
      tokBox.ping({timeout: conf.get('heartbeatTimeout')},
        function(requestError) {
          var status, message;
          if (storageStatus === true && requestError === null) {
            status = 200;
          } else {
            status = 503;
            if (requestError !== null) message = "TokBox " + requestError;
          }

          res.status(status)
             .json({
               storage: storageStatus,
               provider: (requestError === null) ? true : false,
               message: message
             });
        });
    });
  });

  /**
   * Displays some version information at the root of the service.
   **/
  app.get("/", function(req, res) {
    var credentials = {
      name: loopPackageData.name,
      description: loopPackageData.description,
      version: loopPackageData.version,
      homepage: loopPackageData.homepage,
      endpoint: conf.get("protocol") + "://" + req.get('host')
    };

    // Adding information about the tokbox backend
    credentials.fakeTokBox = conf.get('fakeTokBox');
    credentials.fxaOAuth = conf.get('fxaOAuth').activated;

    // Adding localization information for the client.
    credentials.i18n = {
      defaultLang: conf.get("i18n").defaultLang
    };

    if (req.headers["accept-language"]) {
      credentials.i18n.lang = req.headers["accept-language"].split(",")[0];
    }

    if (!conf.get("displayVersion")) {
      delete credentials.version;
    }
    res.status(200).json(credentials);
  });
};
