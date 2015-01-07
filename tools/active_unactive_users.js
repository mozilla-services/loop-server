var conf = require('../loop/config').conf;
var async = require('async');
var redis = require("redis");

var storage = conf.get("storage");
var utils = require("./utils");
var keysInformation = utils.keysInformation;
var dbInformation = utils.dbInformation;

var args = process.argv.slice(2);

var verbose = args.indexOf('--verbose') !== -1;

if (storage.engine === "redis") {
  var options = storage.settings;
  var client = redis.createClient(
    options.port,
    options.host,
    options.options
  );
  if (options.db) client.select(options.db);

  keysInformation(client, 'hawk.*', function(err, keysInfo) {
    if (err) throw err;

     console.log("Processing " + keysInfo.length + " keys");

    var active = 0;
    var unactive = 0;
    var fifteen = 0;
    var monthly = 0;

    keysInfo.forEach(function(key) {
      var lruDate = new Date(Date.now() - key.lru_seconds_idle * 1000).getTime();
      var now = Date.now();

      var delta = (now - lruDate) / 1000;
      var aDay = 3600 * 24;
      var twoWeeks = 3600 * 24 * 7 * 2;
      var aMonth = 3600 * 24 * 30;

      if (delta <= aDay) {
        active++;
      } else {
        unactive++;
      }

      if (delta > twoWeeks) {
        fifteen++;
      }

      if (delta > twoWeeks) {
        monthly++;
      }
    });

    console.log(active + " sessions used during the last 24 hours.");
    console.log(unactive + " sessions not used for the last 24 hours.");
    console.log(fifteen + " sessions not used for the last two weeks.");
    console.log(monthly + " sessions not used for a month.");

    process.exit(0);
  });
}
