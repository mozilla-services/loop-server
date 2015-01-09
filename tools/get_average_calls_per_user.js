var conf = require('../loop/config').conf;
var async = require('async');
var redis = require("redis");

var storage = conf.get("storage");

if (storage.engine === "redis") {
  var options = storage.settings;
  var client = redis.createClient(
    options.port,
    options.host,
    options.options
  );
  if (options.db) client.select(options.db);

  var multi = client.multi();
  multi.eval("return #redis.pcall('keys', 'userUrls.*')", 0);
  multi.keys("userUrls.*");

  multi.exec(function(err, results) {
    if (err) throw err;
    var users = results[0];
    var keys = results[1];
    console.log("processing", keys.length, "users having calls.");

    var multi = client.multi();
    keys.forEach(function(key) {
      multi.scard(key);
    });
    multi.exec(function(err, results) {
      if (err) throw err;
      var totalCalls = results.reduce(function(total, result) {
        return total + result;
      }, 0);
      process.stdout.write(totalCalls + " calls for " +
                           keys.length + " users having calls.\nAverage " +
                           (totalCalls / keys.length).toFixed(2) +
                           " Calls per user.\n");
      process.stdout.write(totalCalls + " calls for " +
                           users + " users having created a call-url.\nAverage " +
                           (totalCalls / users).toFixed(2) +
                           " calls per user.\n");
      process.exit(0);
    });
  });
}
