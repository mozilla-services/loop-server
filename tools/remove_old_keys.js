var conf = require('../loop/config').conf;
var async = require('async');
var redis = require("redis");

var storage = conf.get("storage");
var utils = require("./utils");
var keysInformation = utils.keysInformation;
var dbInformation = utils.dbInformation;
var sget = utils.sget;
var args = process.argv.slice(2);

var verbose = args.indexOf('--verbose') !== -1;
var TWO_WEEKS = 3600 * 24 * 7 * 2;

if (storage.engine === "redis") {
  var options = storage.settings;
  var client = redis.createClient(
    options.port,
    options.host,
    options.options
  );
  if (options.db) client.select(options.db);

  keysInformation(client, '*', function(err, keysInfo) {
    if (err) throw err;

    console.log("Processing " + keysInfo.length + " keys");
    console.log("Looking for keys not used since : " + new Date(Date.now() - TWO_WEEKS * 1000).toLocaleDateString());

    var toDelete = [];

    keysInfo.forEach(function(key) {
      var lruDate = new Date(Date.now() - key.lru_seconds_idle * 1000).getTime();
      var now = Date.now();

      var delta = (now - lruDate) / 1000;

      if (delta > TWO_WEEKS) {
        toDelete.push(key.key);
      }

    });

    if (verbose) {
      console.log("Selected keys:");
      toDelete.forEach(function(key) {
        console.log("- " + key + " deleted");
      });
    }
    console.log(toDelete.length + " keys found.");

    if (toDelete.length > 0) {
      var entry = sget("Would you like to remove these keys? [y/N]");
      if (entry.toLowerCase().indexOf("y") === 0) {
        client.del(toDelete, function(err) {
          if (err) throw err;
          console.log(toDelete.length + " keys have been removed.");
          process.exit(0);
        });
        return;
      }
    }
    console.log("No key has been removed.");
    process.exit(0);
  });
}
