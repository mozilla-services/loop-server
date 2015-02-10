var conf = require('../loop/config').conf;
var migrationClient = require("../loop/storage/redis_migration");
var async = require('async');

var moveRedisData = function(options, callback) {
  var client = migrationClient({
    oldDB: options.migrateFrom,
    newDB: options
  });

  var migratedCounter = 0;

  function scanAndMigrate(cursor) {
    if (cursor === undefined) {
      cursor = 0;
    }
    client.old_db.scan(cursor, function(err, results) {
      if (err) return callback(err);
      var nextCursor = parseInt(results[0], 10);
      if (results[1] === "") {
        return callback(null, 0);
      }
      var keys = results[1].split(',');

      console.log("migrating ", keys.length, "keys");
      migratedCounter += keys.length;

      async.each(keys, function(key, done) {
        client.copyKey(key, done);
      }, function(err) {
        if (nextCursor === 0 || err) {
          callback(err, migratedCounter);
        } else {
          scanAndMigrate(nextCursor);
        }
      });
    });
  };

  scanAndMigrate();
}

function main(options, callback) {
  // Actually call the database migration script.
  if (options.migrateFrom !== undefined) {
    console.log("starting migration");
    console.time("migration");
    moveRedisData(options, function(err, counter){
      console.timeEnd("migration");
      console.log("migrated", counter, "keys");
      callback(err, counter);
    });
  } else {
    console.log("please, change your configuration to enable migration");
    callback();
  }
}

if (require.main === module) {
  var options = conf.get('storage').settings;
  main(options, function() {
    process.exit(0);
  });
}

module.exports = main;
