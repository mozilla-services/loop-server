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

function AwsDriver(options, settings) {
  this._settings = settings || {};
  this._publicBucket = options.publicBucket || DEFAULT_PUBLIC_BUCKET;
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
    if (isUndefined(body, "body", callback)) return;
    var s3 = this._s3;
    console.log('upload.start', {key: filename, bucket: this._publicBucket});
    s3.createBucket({Bucket: this._publicBucket}, function() {
      s3.putObject({
        Body: encode(body),
        Bucket: this._publicBucket,
        Key: filename,
        ContentType: CONTENT_TYPE
      }, function(err, data) {
        if (err) return callback(err);
        console.log('upload.end', {key: filename, data: data});
        callback(null, filename);
      });
    }.bind(this));
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
    var s3 = this._s3;
    console.log('read.start', {key: filename, bucket: this._publicBucket});
    s3.getObject({
      Bucket: this._publicBucket,
      Key: filename
    }, function(err, data) {
      if (err) {
        if (err.code !== "NoSuchKey") return callback(err);
        return callback(null, null);
      }
      console.log("BODY", data);
      var body = data.Body.toString();
      console.log("BODY2", body);
      console.log('read.stop', {key: filename, data: body});
      decode(body, callback);
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
    var s3 = this._s3;
    console.log("delete.start", {bucket: this._publicBucket, key: filename});
    s3.deleteObject({
      Bucket: this._publicBucket,
      Key: filename
    }, function(err, data) {
      console.log(err);
      if (err && err.code !== "NoSuchKey") return callback(err);
      console.log("delete.end", {key: filename, data: data});
      callback(null, filename);
    });
  }
};

module.exports = AwsDriver;
