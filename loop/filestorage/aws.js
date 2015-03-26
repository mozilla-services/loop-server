/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var aws = require('aws-sdk');
var encode = require('../utils').encode;
var decode = require('../utils').decode;
var isUndefined = require('../utils').isUndefined;

var DEFAULT_PUBLIC_BUCKET = "room_encrypted_files";
var CONTENT_TYPE = "application/json";

function AwsDriver(options, settings, statsdClient) {
  this.statsdClient = statsdClient;
  this._settings = settings || {};
  this._publicBucket = settings.bucketName || DEFAULT_PUBLIC_BUCKET;
  if (!/^[a-zA-Z0-9_\-]+$/.test(this._publicBucket)) {
    throw new Error('Illegal Bucket Name: ' + this._publicBucket);
  }
  this._s3 = new aws.S3();
}

AwsDriver.prototype = {

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

    var s3 = this._s3;
    var self = this;
    var startTime = Date.now();
    s3.createBucket({Bucket: this._publicBucket}, function() {
      s3.putObject({
        Body: encode(body),
        Bucket: this._publicBucket,
        Key: filename,
        ContentType: CONTENT_TYPE
      }, function(err) {
        if (err) return callback(err);
        if (self.statsdClient !== undefined) {
          self.statsdClient.timing(
            'aws.write',
            Date.now() - startTime
          );
        }
        callback(null, filename);
      });
    }.bind(this));
  },

  /**
   * Read a given file.
   *
   * @param {String}    filename, the filename of the object to read.
   * @param {Function}  A callback that will be called once data had been
   *                    read.
   **/
  read: function(filename, callback) {
    var s3 = this._s3;
    var self = this;
    var startTime = Date.now();
    s3.getObject({
      Bucket: this._publicBucket,
      Key: filename
    }, function(err, data) {
      if (err) {
        if (err.code !== "NoSuchKey") return callback(err);
        return callback(null, null);
      }
      var body = data.Body.toString();
      if (self.statsdClient !== undefined) {
        self.statsdClient.timing(
          'aws.read',
          Date.now() - startTime
        );
      }
      decode(body, callback);
    });
  },

  /**
   * Remove a given file.
   *
   * @param {String}    filename, the filename of the object to remove.
   * @param {Function}  A callback that will be called once data had been
   *                    removed.
   **/
  remove: function(filename, callback) {
    var s3 = this._s3;
    var self = this;
    var startTime = Date.now();
    s3.deleteObject({
      Bucket: this._publicBucket,
      Key: filename
    }, function(err) {
      if (err && err.code !== "NoSuchKey") return callback(err);
      if (self.statsdClient !== undefined) {
        self.statsdClient.timing(
          'aws.remove',
          Date.now() - startTime
        );
      }
      callback(null, filename);
    });
  }
};

module.exports = AwsDriver;
