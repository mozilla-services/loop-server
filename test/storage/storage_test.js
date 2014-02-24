/* global it, describe */

var expect = require("chai").expect;
var sinon = require("sinon");

var Storage = require("../../loop/storage");
var MongoClient = require('mongodb').MongoClient;
var MongoAdapter = require("../../loop/storage/adapters/mongo");
var MemoryAdapter = require("../../loop/storage/adapters/memory");

describe("Storage", function() {
  "use strict";

  describe("#constructor", function() {
    it("should require an adapter", function() {
      expect(function() {
        new Storage();
      }).Throw(Error, /Invalid adapter/);
    });
  });

  describe("constructed", function() {
    var storage, fakeAdapter;

    beforeEach(function() {
      fakeAdapter = {
        addOne: sinon.spy(),
        getOne: sinon.spy()
      };
      storage = new Storage(fakeAdapter);
    });

    describe("#addSimplepushUrl", function() {
      it("should add a simplepush url", function() {
        var cb = function(){};
        storage.addSimplepushUrl(42, "http://foo", cb);

        sinon.assert.calledOnce(fakeAdapter.addOne);
        sinon.assert.calledWithExactly(fakeAdapter.addOne, "simplepush_urls", {
          userid: 42,
          url: "http://foo"
        }, cb);
      });
    });
  });
});

describe("MongoAdapter", function() {
  "use strict";

  describe("#constructor", function() {
    it("should require a DSN", function() {
      expect(function() {
        new MongoAdapter();
      }).Throw(Error, /A DSN is required/);
    });
  });

  describe("constructed", function() {
    var adapter;

    beforeEach(function() {
      adapter = new MongoAdapter('mongodb://127.0.0.1:27017/loop_test');
    });

    afterEach(function(done) {
      adapter.drop(function(err) {
        done(err);
      });
    });

    describe("#addOne", function() {
      it("should add a record to a given collection", function(done) {
        adapter.addOne("test_coll", {a: 1, b: 2}, function(err, record) {
          expect(err).to.be.a("null");
          expect(record).to.be.a("object");
          expect(record.a).eql(1);
          done();
        });
      });
    });

    describe("#getOne", function() {
      it("should retrieve a record out of a query object", function(done) {
        adapter.addOne("test_coll", {a: 1, b: 2}, function(err) {
          adapter.getOne("test_coll", {a: 1}, function(err, record) {
            expect(err).to.be.a("null");
            expect(record).to.be.a("object");
            expect(record.a).eql(1);
            done();
          });
        });
      });

      it("should give an error on no record found", function(done) {
        adapter.getOne("test_coll", {x: 42}, function(err, record) {
          expect(err).to.be.a.instanceOf(Error);
          expect(err.message).to.match(/No record found matching query/);
          done();
        });
      });
    });

    describe("#drop", function() {
      it("should drop the database", function(done) {
        adapter.addOne("bar", {a: 1}, function() {
          adapter.drop(function(err) {
            expect(err).to.be.a("null");
            adapter.getOne("test_coll", {a: 1}, function(err, record) {
              expect(err).to.be.a("object");
              done();
            });
          });
        });
      });
    });
  });
});

describe("MemoryAdapter", function() {
  "use strict";

  describe("constructed", function() {
    var adapter;

    beforeEach(function() {
      adapter = new MemoryAdapter();
    });

    afterEach(function(done) {
      adapter.drop(function(err) {
        done(err);
      });
    });

    describe("#addOne", function() {
      it("should add a record to a given collection", function(done) {
        adapter.addOne("test_coll", {a: 1, b: 2}, function(err, record) {
          expect(err).to.be.a("null");
          expect(record).to.be.a("object");
          expect(record.a).eql(1);
          done();
        });
      });
    });

    describe("#getOne", function() {
      it("should retrieve a record out of a query object", function(done) {
        adapter.addOne("test_coll", {a: 1, b: 2}, function(err) {
          adapter.getOne("test_coll", {a: 1}, function(err, record) {
            expect(err).to.be.a("null");
            expect(record).to.be.a("object");
            expect(record.a).eql(1);
            done();
          });
        });
      });

      it("should give an error on no record found", function(done) {
        adapter.getOne("test_coll", {x: 42}, function(err, record) {
          expect(err).to.be.a.instanceOf(Error);
          expect(err.message).to.match(/No record found matching query/);
          done();
        });
      });
    });

    describe("#drop", function() {
      it("should drop the database", function(done) {
        adapter.addOne("bar", {a: 1}, function() {
          adapter.drop(function(err) {
            expect(err).to.be.a("null");
            adapter.getOne("test_coll", {a: 1}, function(err, record) {
              expect(err).to.be.a("object");
              done();
            });
          });
        });
      });
    });
  });
});
