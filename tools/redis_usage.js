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

  client.info(function(err, info){
    process.stdout.write(info);
    process.stdout.write("\n ==== \n\n");

    var KEYS = ["spurl", "callurl", "userUrls", "call", "userCalls",
                "callstate", "hawkuser", "userid", "hawk", "oauth.token",
                "oauth.state"];

    var multi = client.multi();
    KEYS.forEach(function(key) {
      multi.keys(key + ".*");
    });

    multi.exec(function(err, results) {
      if (err) throw err;
      var i = 0;
      results.forEach(function(result) {
        process.stdout.write(KEYS[i] + ".*: \t" + result.length + "\n");
        if (result.length > 0) {
          process.stdout.write(result[0]);
        }
        if (result.length > 1) {
          process.stdout.write(result[1]);
        }
        i++;
      });
      process.exit(0);
    });
  });
}
