/* global it, describe */

var expect = require("chai").expect;

var MongoStorage = require("../loop/storage/mongo");
var MemoryStorage = require("../loop/storage/memory");

describe("Storages", function() {
  "use strict";

  describe("MongoStorage", function() {
    describe("#constructor", function() {
      it("should require a connection string", function() {
        expect(function() {
          new MongoStorage();
        }).Throw(Error, /A connection string is required/);
      });
    });
  });

  // both storages implements the same interface, so using the very same suite
  function testStorage(name, createFn) {
    describe(name, function() {
      var storage;

      beforeEach(function() {
        storage = createFn();
      });

      afterEach(function(done) {
        storage.drop(function(err, x) {
          done(err);
        });
      });

      describe("#addSimplepushUrl", function() {
        it("should store a simplepush url record", function(done) {
          storage.addSimplepushUrl("bob", "http://bob", function(err, record) {
            expect(err).to.be.a("null");
            expect(record).to.be.an("object");
            expect(record.userid).eql("bob");
            expect(record.simplepush_url).eql("http://bob");
            done();
          });
        });

        it("should send an error on duplicate entry", function(done) {
          storage.addSimplepushUrl("a", "http://a", function(err) {
            storage.addSimplepushUrl("a", "http://a", function(err) {
              expect(err).to.be.an.instanceOf(Error, /Duplicate/);
              done();
            });
          });
        });
      });

      describe("#getSimplepushUrls", function() {
        beforeEach(function(done) {
          // XXX: better way to handle fixtures?
          storage.addSimplepushUrl("bob", "http://bob1", function() {
            storage.addSimplepushUrl("bob", "http://bob2", function() {
              done();
            });
          });
        });

        it("should find multiple records for a single user", function(done) {
          storage.getSimplepushUrls("bob", function(err, records) {
            expect(records).to.be.an("array");
            expect(records).to.have.length.of(2);
            expect(records[0].userid).eql("bob");
            expect(records[0].simplepush_url).eql("http://bob1");
            expect(records[1].userid).eql("bob");
            expect(records[1].simplepush_url).eql("http://bob2");
            done();
          });
        });

        it("should send an empty list on no result found", function(done) {
          storage.getSimplepushUrls("bill", function(err, records) {
            expect(err).to.be.a("null");
            expect(records).to.be.an("array");
            expect(records).to.have.length.of(0);
            done();
          });
        });
      });

      describe("#addCallInfo", function() {
        it("should store a call info record", function(done) {
          storage.addCallInfo("bob", "token", "session", function(err, record) {
            expect(err).to.be.a("null");
            expect(record).to.be.an("object");
            expect(record.userid).eql("bob");
            expect(record.token).eql("token");
            expect(record.session).eql("session");
            done();
          });
        });
      });

      describe("#getCallInfo", function() {
        beforeEach(function(done) {
          // XXX: better way to handle fixtures?
          storage.addCallInfo("bob", "token", "session", function() {
            done();
          });
        });

        it("should find a call info record for a given user", function(done) {
          storage.getCallInfo("bob", function(err, record) {
            expect(err).to.be.a("null");
            expect(record).to.be.an("object");
            expect(record.userid).eql("bob");
            expect(record.token).eql("token");
            expect(record.session).eql("session");
            done();
          });
        });

        it("should send a null on no result found", function(done) {
          storage.getCallInfo("bill", function(err, record) {
            expect(err).to.be.a("null");
            expect(record).to.be.an("undefined");
            done();
          });
        });
      });

      describe("#drop", function() {
        this.timeout(5000); // mongodb drop operation can take more than 2s.

        it("should drop the database", function(done) {
          storage.addSimplepushUrl("bob", "http://bob", function() {
            storage.drop(function(err) {
              expect(err).to.be.a("null");
              storage.getSimplepushUrls("bob", function(err, records) {
                expect(records).to.have.length.of(0);
                done();
              });
            });
          });
        });
      });
    });
  }

  describe("constructed", function() {
    testStorage("MongoStorage", function createMongoStorage() {
      return new MongoStorage('mongodb://127.0.0.1:27017/loop_test');
    });

    testStorage("MemoryStorage", function createMemoryStorage() {
      return new MemoryStorage();
    });
  });
});
