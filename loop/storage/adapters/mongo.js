var MongoClient = require('mongodb').MongoClient;

module.exports = function MongoAdapter(dsn) {
  "use strict";

  var db;

  if (!dsn)
    throw new Error("A DSN is required");

  function _ensureConnected(cb) {
    if (db)
      return cb(null, db);
    MongoClient.connect(dsn, function(err, resultDb) {
      if (err)
        return cb(err);
      db = resultDb;
      cb(null, db);
    });
  }

  return {
    addOne: function(coll, record, cb) {
      _ensureConnected(function(err, db) {
        if (err)
          return cb(err);
        db.collection(coll).insert(record, function(err, records) {
          if (err)
            return cb(err);
          cb(null, records[0]);
        });
      });
    },

    getOne: function(coll, query, cb) {
      _ensureConnected(function(err, db) {
        if (err)
          return cb(err);
        db.collection(coll).findOne(query, cb);
      });
    },

    drop: function(cb) {
      _ensureConnected(function(err, db) {
        db.dropDatabase(cb);
      });
    }
  };
};
