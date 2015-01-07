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

  dbInformation(client, options.db, function(err, info) {
    if (err) throw err;

    var average_ttl = parseInt(info.avg_ttl / 1000, 10);
    console.log("Processing " + info.keys + " keys");

    keysInformation(client, '*', function(err, keysInfo) {
      if (err) throw err;

      var creations = {};
      var sizes = {};
      var expirations = {};

      keysInfo.forEach(function(key) {
        var creationDate = new Date(Date.now() - key.lru_seconds_idle * 1000).toDateString();
        var expirationDate = new Date(Date.now() + (average_ttl - key.lru_seconds_idle) * 1000).toDateString();
        var size = parseInt(key.serializedlength, 10);
        expirations[expirationDate] = expirations[expirationDate] ? expirations[expirationDate] + 1 : 1;
        creations[creationDate] = creations[creationDate] ? creations[creationDate] + 1 : 1;
        sizes[creationDate] = sizes[creationDate] ? sizes[creationDate] + size : size;
        sizes[expirationDate] = sizes[expirationDate] ? sizes[expirationDate] + size : size;
      });

      var creation_keys = Object.keys(creations);
      creation_keys.sort(function(a, b) {
        var date_a = new Date(a);
        var date_b = new Date(b);
        return date_a.getTime() - date_b.getTime();
      });

      var today = new Date();
      creation_keys.forEach(function(key) {
        var date = new Date(key);
        var nb_days = parseInt((date.getTime() - today.getTime()) / (24 * 3600 * 1000), 10) + 1;
        console.log(date.getUTCFullYear() + "/" + (date.getUTCMonth() + 1) + "/" + date.getUTCDate() + "\t" + creations[key] + "\t" + (sizes[key]) + " Bytes\t(in " + nb_days + " days)");
      });

      var expiration_keys = Object.keys(expirations);
      expiration_keys.sort(function(a, b) {
        var date_a = new Date(a);
        var date_b = new Date(b);
        return date_a.getTime() - date_b.getTime();
      });

      expiration_keys.forEach(function(key) {
        var date = new Date(key);
        var nb_days = parseInt((date.getTime() - today.getTime()) / (24 * 3600 * 1000), 10) + 1;
        console.log(date.getUTCFullYear() + "/" + (date.getUTCMonth() + 1) + "/" + date.getUTCDate() + "\t" + expirations[key] + "\t" + (sizes[key]) + " Bytes\t(in " + nb_days + " days)");
      });


      process.exit(0);
    });
  });
}
