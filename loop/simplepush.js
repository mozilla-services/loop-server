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
      request.put({
        url: simplePushUrl,
        form: { version: version }
      }, function(err) {
        var status = 'success';
        if (err) {
          self.logError(err);
          status = 'failure';
        }
        if (self.statsdClient !== undefined) {
          self.statsdClient.increment("loop.simplepush.call", 1, [reason, status]);
        }
      });
    });
  }
}

module.exports = SimplePush;
