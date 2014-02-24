var MongoClient = require('mongodb').MongoClient;

module.exports = function MongoStorage(connectionString) {
  "use strict";

  var db;

  if (!connectionString)
    throw new Error("A connection string is required");

  function _setupDb(cb) {
    // XXX oh my this is ugly; investigate use of async.js or promises here
    db.collection("simplepush_urls").ensureIndex({
      userid: 1,
      simplepush_url: 1
    }, {unique: true}, function(err) {
      if (err) return cb(err);
      db.collection("call_info").ensureIndex({userid: 1}, {}, function(err) {
        if (err) return cb(err);
        cb(null, db);
      });
    });
  }

  /**
   * Ensures the database is connected. Sends an existing opened database
   * instance if it exists, creates one if it's not.
   * @private
   * @param  {Function} cb Callback(err, db)
   */
  function _ensureConnected(cb) {
    if (db) return cb(null, db);
    MongoClient.connect(connectionString, function(err, newDb) {
      if (err) return cb(err);
      db = newDb;
      _setupDb(cb);
    });
  }

  return {
    addSimplepushUrl: function(userid, simplepush_url, cb) {
      var record = {userid: userid, simplepush_url: simplepush_url};
      _ensureConnected(function(err, db) {
        if (err) return cb(err);
        db.collection("simplepush_urls").insert(record, function(err, records) {
          if (err) return cb(err);
          cb(null, records[0]);
        });
      });
    },

    getSimplepushUrls: function(userid, cb) {
      _ensureConnected(function(err, db) {
        if (err) return cb(err);
        db.collection("simplepush_urls")
          .find({userid: userid})
          .toArray(cb);
      });
    },

    addCallInfo: function(userid, token, session, cb) {
      var record = {userid: userid, token: token, session: session};
      _ensureConnected(function(err, db) {
        if (err) return cb(err);
        db.collection("call_info").insert(record, function(err, records) {
          if (err) return cb(err);
          cb(null, records[0]);
        });
      });
    },

    getCallInfo: function(userid, cb) {
      _ensureConnected(function(err, db) {
        if (err) return cb(err);
        db.collection("call_info")
          .find({userid: userid})
          .toArray(function(err, records) {
            cb(err, records[0]);
          });
      });
    },

    /**
     * Drops current database, if any.
     * @param  {Function} cb Callback(err)
     */
    drop: function(cb) {
      if (!db)
        return cb(null);
      db.dropDatabase(cb);
    }
  };
};
