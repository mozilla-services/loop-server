var MongoClient = require('mongodb').MongoClient;

module.exports = function MongoAdapter(connectionString) {
  "use strict";

  var db;

  if (!connectionString)
    throw new Error("A connection string is required");

  function _ensureConnected(cb) {
    if (db)
      return cb(null, db);
    MongoClient.connect(connectionString, function(err, resultDb) {
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
        db.collection(coll).findOne(query, function(err, record) {
          if (!record)
            return cb(new Error("No record found matching query"));
          cb(null, record);
        });
      });
    },

    drop: function(cb) {
      _ensureConnected(function(err, db) {
        db.dropDatabase(cb);
      });
    }
  };
};
