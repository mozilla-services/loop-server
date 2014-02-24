var MongoClient = require('mongodb').MongoClient;

module.exports = function MongoAdapter(connectionString) {
  "use strict";

  var db;

  if (!connectionString)
    throw new Error("A connection string is required");

  /**
   * Ensures the database is connected. Sends an existing opened database
   * instance if it exists, creates one if it's not.
   * @private
   * @param  {Function} cb Callback(err, db)
   */
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
    /**
     * Adds a single record to the collection.
     * @param {String}   coll   Collection name
     * @param {Object}   record Record Object
     * @param {Function} cb     Callback(err, record)
     */
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

    /**
     * Retrieves a single record matching the provided query object. Sends back
     * an error if no matching entry was found.
     * @param  {String}   coll  Collection name
     * @param  {Object}   query Query object
     * @param  {Function} cb    Callback(err, record)
     */
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

    /**
     * Drops current database.
     * @param  {Function} cb Callback(err)
     */
    drop: function(cb) {
      _ensureConnected(function(err, db) {
        db.dropDatabase(cb);
      });
    }
  };
};
