/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var expect = require("chai").expect;
var sinon = require("sinon");

var getFileStorage = require("../loop/filestorage");
var uuid = require("node-uuid");
var path = require("path");
var fs = require("fs");

var httpMock = require("./nock");

describe("Files", function() {
  function testStorage(name, verifyNock, createStorage) {
    var storage, mock, statsdSpy;

    describe(name, function() {
      var sandbox, statsdClient;

      beforeEach(function(done) {
        sandbox = sinon.sandbox.create();
        statsdClient = { timing: function() {} };
        statsdSpy = sandbox.spy(statsdClient, "timing");
        mock = httpMock({bucket: 'room_encrypted_files'});
        createStorage({}, statsdClient, function(err, fileStorage) {
          storage = fileStorage;
          done(err);
        });
      });

      afterEach(function(done) {
        sandbox.restore();
        // Ignore remove errors.
        mock.removeAws();
        storage.remove("test", function() {
          mock.removeAws();
          storage.remove("foobar", function() {
            storage = undefined;
            mock.done(verifyNock);
            done();
          });
        });
      });

      it("should write a file.", function(done) {
        mock.writeAws();
        storage.write("test", {"key": "data"}, function(err) {
          if (err) throw err;
          expect(statsdSpy.called).to.be.true;
          statsdSpy.reset();
          mock.readAws();
          storage.read("test", function(err, data) {
            if (err) throw err;
            expect(data).to.eql({"key": "data"});
            expect(statsdSpy.called).to.be.true;
            done();
          });
        });
      });

      it("should override a file.", function(done) {
        mock.writeAws();
        storage.write("foobar", {"key": "data"}, function(err) {
          if (err) throw err;
          mock.writeAws();
          storage.write("foobar", {"key": "data2"}, function(err) {
            if (err) throw err;
            mock.readAws();
            storage.read("foobar", function(err, data) {
              if (err) throw err;
              expect(data).to.eql({"key": "data2"});
              done();
            });
          });
        });
      });

      it("should remove a file.", function(done) {
        mock.writeAws();
        storage.write("foobar", {"key": "data"}, function(err) {
          if (err) throw err;
          statsdSpy.reset();
          mock.removeAws();
          storage.remove("foobar", function(err) {
            if (err) throw err;
            expect(statsdSpy.called).to.be.true;
            mock.readAws();
            storage.read("foobar", function(err, data) {
              if (err) throw err;
              expect(data).to.eql(null);
              done();
            });
          });
        });
      });

      it("should not fail when removing an unexisting file.", function(done) {
        mock.removeAws();
        storage.remove("foobar", function(err) {
          if (err) throw err;
          done();
        });
      });
    });
  }

  // Test all the file storages implementation.

  testStorage("AWS", true,
    function createAWSStorage(options, statsdClient, callback) {
      callback(null, getFileStorage({
        engine: "aws",
        settings: {sslEnabled: true}
      }, options, statsdClient));
    });

  testStorage("Filesystem", false,
    function createFilesystemStorage(options, statsdClient, callback) {
      var test_base_dir = path.join("/tmp", uuid.v4());
      fs.mkdir(test_base_dir, '0750', function(err) {
        if (err) return callback(err);
        callback(null, getFileStorage({
          engine: "filesystem",
          settings: {base_dir: test_base_dir}
        }, options, statsdClient));
      });
    });
});
