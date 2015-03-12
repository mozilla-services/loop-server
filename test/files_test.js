/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var expect = require("chai").expect;
var assert = require("chai").assert;
var sinon = require("sinon");

var getFileStorage = require("../loop/files");
var conf = require("../loop").conf;
var uuid = require("node-uuid");
var path = require("path");
var fs = require("fs");


describe.only("Files", function() {
  function testStorage(name, createStorage) {
    var storage;

    describe(name, function() {
      var sandbox;

      beforeEach(function(done) {
        sandbox = sinon.sandbox.create();
        createStorage({}, function(err, fileStorage) {
          storage = fileStorage;
          done(err);
        });
      });

      afterEach(function(done) {
        sandbox.restore();
        // Ignore remove errors.
        storage.remove("test", function() {
          storage.remove("foobar", function() {
            storage = undefined;
            done();
          });
        });
      });

      it("should write a file.", function(done) {
        storage.write("test", "data", function(err) {
          if (err) throw err;
          storage.read("test", function(err, data) {
            if (err) throw err;
            expect(data).to.eql("data");
            done();
          });
        });
      });

      it("should override a file.", function(done) {
        storage.write("foobar", "data", function(err) {
          if (err) throw err;
          storage.write("foobar", "data2", function(err) {
            if (err) throw err;
            storage.read("foobar", function(err, data) {
              if (err) throw err;
              expect(data).to.eql("data2");
              done();
            });
          });
        });
      });

      it("should remove a file.", function(done) {
        storage.write("foobar", "data", function(err) {
          if (err) throw err;
          storage.remove("foobar", function(err) {
            if (err) throw err;
            storage.read("foobar", function(err, data) {
              if (err) throw err;
              expect(data).to.eql(null);
              done();
            });
          });
        });
      });

      it("should not fail when removing an unexisting file.", function(done) {
        storage.remove("foobar", function(err) {
          if (err) throw err;
          done();
        });
      });

      it("should expire a file.", function(done) {
        storage.write("foobar", "data", 0.1, function(err) {
          if (err) throw err;
          setTimeout(function() {
            storage.read("foobar", function(err, data) {
              if (err) throw err;
              expect(data).to.eql(null);
            });
            done();
          }, 100);
        });
      });
    });
  }

  // Test all the storages implementation.
  testStorage("Filesystem", function createFilesysteStorage(options, callback) {
    var test_base_dir = path.join("var/tests/fs/", uuid.v4());
    fs.mkdir(test_base_dir, '0750', function(err) {
      if (err) return callback(err);
      callback(null, getFileStorage({
        engine: "filesystem",
        settings: {base_dir: test_base_dir}
      }, options));
    });
  });
});
