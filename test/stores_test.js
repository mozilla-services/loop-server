/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global it, describe */

var expect = require("chai").expect;

var MongoStore = require("../loop/stores/mongo");
var MemoryStore = require("../loop/stores/memory");
var getStore = require("../loop/stores").getStore;

describe("Stores", function() {
  "use strict";

  describe("getStore", function() {
    it("should load an existing store", function() {
      var conf = {
        engine: 'mongo',
        settings: {
          connectionString: 'mongodb://127.0.0.1:27017/loop_test',
          name: 'temporary'
        }
      };

      expect(getStore(conf)).to.be.an("object");
    });

    it("should fail loading a non-existing store", function() {
      expect(function() {
        getStore({engine: 'does-not-exist'});
      }).to.Throw(/Cannot find module/);
    });
  });

  describe("MongoStore", function() {
    describe("#constructor", function() {
      it("should require a connection string argument", function() {
        expect(function() {
          new MongoStore();
        }).Throw(Error, /connectionString/);
      });

      it("should require a name argument", function() {
        expect(function() {
          new MongoStore({connectionString: "foo"});
        }).Throw(Error, /name/);
      });
    });

    describe("get name()", function() {
      it("should expose a name property", function() {
        var store = new MongoStore({
          connectionString: "foo",
          name: "bar"
        });
        expect(store.name).eql("bar");
      });
    });
  });

  describe("MemoryStore", function() {
    describe("get name()", function() {
      it("should expose a null name property", function() {
        var store = new MemoryStore();
        expect(store.name).to.be.a("null");
      });
    });
  });

  // both stores implements the same interface, so using the very same suite
  // for both
  function testStore(name, createStore) {
    describe(name, function() {
      var store;

      afterEach(function(done) {
        store.drop(function(err) {
          store = undefined;
          done(err);
        });
      });

      describe("#add", function() {
        describe("without unique checks enabled", function() {
          beforeEach(function() {
            store = createStore();
          });

          it("should add a record to a given collection", function(done) {
            store.add({a: 1, b: 2}, function(err, record) {
              expect(err).to.be.a("null");
              expect(record).to.be.a("object");
              expect(record.a).eql(1);
              done();
            });
          });

          it("should allow storing duplicates", function(done) {
            store.add({a: 1, b: 2}, function(err, record) {
              store.add({a: 1, b: 2}, function(err) {
                expect(err).to.be.a("null");
                done();
              });
            });
          });
        });

        describe("with unique checks enabled, single field", function() {
          beforeEach(function() {
            store = createStore({unique: ["a"]});
          });

          it("shouldn't allow storing duplicates", function(done) {
            store.add({a: 1, b: 2}, function(err) {
              store.add({a: 1, b: 3}, function(err) {
                expect(err).to.be.an.instanceOf(Error);
                done();
              });
            });
          });
        });

        describe("with unique checks enabled, multiple field", function() {
          beforeEach(function() {
            store = createStore({unique: ["a", "b"]});
          });

          it("shouldn't allow storing duplicates", function(done) {
            store.add({a: 1, b: 2}, function(err) {
              store.add({a: 1, b: 2}, function(err) {
                expect(err).to.be.an.instanceOf(Error);
                done();
              });
            });
          });

          it("shouldn't send an error on partial duplicate", function(done) {
            store.add({a: 1, b: 2}, function(err) {
              store.add({a: 1, b: 3}, function(err) {
                expect(err).to.be.a("null");
                done();
              });
            });
          });
        });
      });

      describe("#updateOrCreate", function() {
        beforeEach(function() {
          store = createStore();
        });

        it("should add missing records.", function(done) {
          store.updateOrCreate({'user': 'NotFound'}, {
            user: "Found"
          }, function(err) {
            if(err) {
              throw err;
            }
          });
          store.find({user: "Found"}, function(err, records) {
            expect(err).to.be.a("null");
            expect(records).to.have.length.of(1);
            done();
          });
        });

        it("should update all matching records.", function(done) {
          store.add({"a": "Found", "b": 1}, function(err) {
            if(err) {
              throw err;
            }
            store.add({"a": "Found", "b": 2}, function(err) {
              store.add({"a": "Not Found", "b": 5}, function(err) {
                store.updateOrCreate({
                  "a": "Found"
                }, {
                  "a": "Found",
                  "b": 10
                }, function(err) {
                  if(err) {
                    throw err;
                  }

                  store.find({"a": "Found", b: 10}, function(err, records) {
                    if(err) {
                      throw err;
                    }

                    expect(records).to.have.length.of(2);
                    store.find({
                      "a": "Not Found",
                      "b": 5
                    }, function(err, records) {
                      expect(records).to.have.length.of(1);
                      done();
                    });
                  });
                });
              });
            });
          });
        });
      });

      describe("#find", function() {
        beforeEach(function() {
          store = createStore();
        });

        it("should retrieve records out of a query object", function(done) {
          store.add({a: 1, b: 2}, function() {
            store.add({a: 1, b: 3}, function() {
              store.find({a: 1}, function(err, records) {
                expect(err).to.be.a("null");
                expect(records).to.have.length.of(2);
                done();
              });
            });
          });
        });

        it("should retrieve records matching all passed criterias",
          function(done) {
            store.add({a: 1, b: 2, c: 42}, function() {
              store.add({a: 1, b: 3, c: 42}, function() {
                store.find({a: 1, c: 42}, function(err, records) {
                  expect(err).to.be.a("null");
                  expect(records).to.have.length.of(2);
                  expect(records[0].b).eql(2);
                  expect(records[1].b).eql(3);
                  done();
                });
              });
            });
          });

        it("should return an empty array on no match found", function(done) {
          store.find({x: 42}, function(err, records) {
            expect(err).to.be.a("null");
            expect(records).to.be.a("array");
            expect(records).to.have.length.of(0);
            done();
          });
        });
      });

      describe("#findOne", function() {
        beforeEach(function() {
          store = createStore();
        });

        it("should retrieve a record out of a query object", function(done) {
          store.add({a: 1, b: 2}, function(err) {
            store.findOne({a: 1}, function(err, record) {
              expect(err).to.be.a("null");
              expect(record).to.be.a("object");
              expect(record.a).eql(1);
              done();
            });
          });
        });

        it("should return a null when no record is found", function(done) {
          store.findOne({x: 42}, function(err, record) {
            expect(err).to.be.a("null");
            expect(record).to.be.a("null");
            done();
          });
        });
      });

      describe("#delete", function() {
        beforeEach(function() {
          store = createStore();
        });

        it("should delete all record matching the query and return them.",
          function(done) {
            store.add({a: 1, b: 2}, function(err) {
              store.add({a: 1, b: 3}, function(err) {
                store.delete({a: 1}, function(err, records) {
                  expect(err).to.be.a("null");
                  expect(records).to.be.a("array");
                  expect(records).to.have.length(2);
           
                  store.find({a: 1}, function(err, records) {
                    expect(records).to.have.length(0);
                    done();
                  });
                });
              });
            });
          });

        it("should return a null when no record is found", function(done) {
          store.delete({x: 42}, function(err, record) {
            expect(err).to.be.a("null");
            expect(record).to.be.a("null");
            done();
          });
        });
      });

      describe("#drop", function() {
        beforeEach(function() {
          store = createStore();
        });

        it("should drop the database", function(done) {
          store.add({a: 1}, function() {
            store.drop(function(err) {
              expect(err).to.be.a("null");
              store.find({}, function(err, records) {
                expect(err).to.be.a("null");
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
    testStore("MongoStore", function createMongoStore(options) {
      return new MongoStore({
        connectionString: "mongodb://127.0.0.1:27017/loop_test",
        name: "test_coll"
      }, options);
    });

    testStore("MemoryStore", function createMemoryStore(options) {
      return new MemoryStore({}, options);
    });
  });
});
