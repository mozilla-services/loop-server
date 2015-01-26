var conf = require('../loop/config').conf;
var migrationClient = require("../loop/storage/redis_migration");
var async = require('async');

var moveRedisData = function(options, callback) {
  var client = migrationClient({
    oldDB: options.migrateFrom,
    newDB: options
  });

  client.old_db.keys('*', function(err, keys) {
    if (err) throw err;
    console.log("migrating ", keys.length, "keys");
    async.each(keys, function(key, done) {
      client.copyKey(key, done);
    }, function(err) {
      callback();
    });
  });
}

function main(options, callback) {
  // Actually call the database migration script.
  if (options.migrateFrom !== undefined) {
    console.log("starting migration");
    console.time("migration");
    moveRedisData(options, function(){
      console.timeEnd("migration");
      callback();
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
