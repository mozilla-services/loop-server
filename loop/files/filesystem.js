/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var isUndefined = function(field, fieldName, callback) {
  if (field === undefined) {
    callback(new Error(fieldName + " should not be undefined"));
    return true;
  }
  return false;
};

function encode(data) {
  return JSON.stringify(data);
}

function decode(string, callback) {
  try {
    callback(null, JSON.parse(string));
  } catch (e) {
    callback(e);
  }
}

function Filesystem(options, settings) {
  this._settings = settings;
  this._base_dir = options.base_dir;
}

Filesystem.prototype = {

  /**
   * Create or override a file.
   *
   * @param {String}    filename, the filename of the object to store.
   * @param {String}    body, the content of the file to store
   * @param {Float}     file ttl in seconds
   * @param {Function}  A callback that will be called once data had been
   *                    stored.
   **/
  write: function(filename, body, ttl, callback) {
    if (isUndefined(filename, "filename", callback)) return;
    if (isUndefined(body, "body", callback)) return;
    if (callback === undefined) {
      callback = ttl;
      ttl = undefined;
    }
    var file_path = this.createPath(filename);
    fs.mkdir(path.dirname(file_path), '0750', function(err) {
      if (err && err.code !== 'EEXIST') return callback(err);
      fs.writeFile(file_path, encode({
        expiresAt: Date.now() + (ttl * 1000),
        content: body
      }), callback);
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
    fs.readFile(self.createPath(filename), function(err, data) {
      if (err) {
        if (err.code === "ENOENT") return callback(null, null);
        return callback(err);
      }
      decode(data, function(err, data) {
        if (err) return callback(err);
        // Handle the file ttl
        if (data.hasOwnProperty('expiresAt')) {
          if (data.expiresAt !== null && data.expiresAt <= Date.now()) {
            return self.remove(filename, function(err) {
              if (err) return callback(err);
              callback(null, null);
            });
          }
        }
        callback(null, data.content);
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
    fs.unlink(this.createPath(filename), function(err) {
      if (err && err.code !== "ENOENT") return callback(err);
      callback();
    });
  },

  /**
   * Build a path for the given filename.
   *
   * @param {String}    filename, the filename of the object to store.
   * @param {String}    body, the content of the file to store
   * @param {Function}  A callback that will be called once data had been
   *                    stored.
   **/
  createPath: function(filename) {
    var shasum = crypto
      .createHash("sha256")
      .update(filename)
      .digest()
      .toString('hex');
    return path.join(this._base_dir,
                     shasum.substring(0,3),
                     shasum.substring(3));
  }
};

module.exports = Filesystem;
