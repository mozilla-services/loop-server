/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var encode = require('../utils').encode;
var decode = require('../utils').decode;
var isUndefined = require('../utils').isUndefined;

function Filesystem(settings, options, statsdClient) {
  this.statsdClient = statsdClient;
  this._base_dir = settings.base_dir;
}

Filesystem.prototype = {

  /**
   * Create or override a file.
   *
   * @param {String}    filename, the filename of the object to store.
   * @param {String}    body, the content of the file to store
   * @param {Function}  A callback that will be called once data had been
   *                    stored.
   **/
  write: function(filename, body, callback) {
    if (isUndefined(filename, "filename", callback)) return;
    if (body === undefined) return callback(null, null);
    var file_path = this.buildPath(filename);
    var self = this;
    var startTime = Date.now();
    fs.mkdir(path.dirname(file_path), '0750', function(err) {
      if (err && err.code !== 'EEXIST') return callback(err);
      fs.writeFile(file_path, encode(body), function(err) {
        if (err) return callback(err);
        if (self.statsdClient !== undefined) {
          self.statsdClient.timing(
            'loop.filesystem.write',
            Date.now() - startTime
          );
        }
        callback();
      });
    });
  },

  /**
   * Read a given file.
   *
   * @param {String}    filename, the filename of the object to store.
   * @param {String}    body, the content of the file to store
   * @param {Function}  A callback that will be called once data had been
   *                    stored.
   **/
  read: function(filename, callback) {
    var self = this;
    var startTime = Date.now();
    fs.readFile(self.buildPath(filename), function(err, data) {
      if (err) {
        if (err.code === "ENOENT") return callback(null, null);
        return callback(err);
      }
      decode(data, function(err, data) {
        if (err) return callback(err);
        if (self.statsdClient !== undefined) {
          self.statsdClient.timing(
            'loop.filesystem.read',
            Date.now() - startTime
          );
        }
        callback(null, data);
      });
    });
  },

  /**
   * Remove a given file.
   *
   * @param {String}    filename, the filename of the object to store.
   * @param {String}    body, the content of the file to store
   * @param {Function}  A callback that will be called once data had been
   *                    stored.
   **/
  remove: function(filename, callback) {
    var self = this;
    var startTime = Date.now();
    fs.unlink(this.buildPath(filename), function(err) {
      if (err && err.code !== "ENOENT") return callback(err);
      if (self.statsdClient !== undefined) {
        self.statsdClient.timing(
          'loop.filesystem.remove',
          Date.now() - startTime
        );
      }
      callback();
    });
  },

  /**
   * Build a path for the given filename (with a hash of the filename).
   *
   * @param {String}    filename, the filename of the object to store.
   * @param {String}    body, the content of the file to store
   * @param {Function}  A callback that will be called once data had been
   *                    stored.
   **/
  buildPath: function(filename) {
    var shasum = crypto
      .createHash("sha256")
      .update(filename)
      .digest()
      .toString('hex');
    return path.join(this._base_dir,
                     shasum.substring(0, 3),
                     shasum.substring(3));
  }
};

module.exports = Filesystem;
