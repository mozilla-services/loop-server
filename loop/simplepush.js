/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var request = require('request');
var dedupeArray = require('./utils').dedupeArray;

/**
 * Simple client to handle simple push notifications
 **/
var SimplePush = function(statsdClient, logError) {
  this.statsdClient = statsdClient;
  this.logError = logError || function() {};
}

SimplePush.prototype = {
  notify: function(reason, urls, version){
    if (!Array.isArray(urls)) {
      urls = [urls];
    }

    urls = dedupeArray(urls);

    var self = this;

    urls.forEach(function(simplePushUrl) {
      if (self.statsdClient !== undefined) {
        self.statsdClient.count("loop.simplepush.call", 1);
        self.statsdClient.count("loop.simplepush.call." + reason, 1);
      }
      request.put({
        url: simplePushUrl,
        form: { version: version }
      }, function(err) {
        if (self.statsdClient !== undefined) {
          if (err) {
            self.logError(err);
            self.statsdClient.count("loop.simplepush.call.failures", 1);
            self.statsdClient.count("loop.simplepush.call." + reason + ".failures", 1);
          } else {
            self.statsdClient.count("loop.simplepush.call.success", 1);
            self.statsdClient.count("loop.simplepush.call." + reason + ".success", 1);
          }
        }
      });
    });
  }
}

module.exports = SimplePush;
