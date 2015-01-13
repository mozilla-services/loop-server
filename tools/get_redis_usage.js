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
    if (err) throw err;
    process.stdout.write(info);
    process.stdout.write("\n ==== \n\n");

    var KEYS = ["spurls", "callurl", "userUrls", "call", "userCalls",
                "callstate", "hawkuser", "userid", "hawk", "oauth.token",
                "oauth.state", "userRooms", "rooms"];

    var multi = client.multi();
    KEYS.forEach(function(key) {
      multi.keys(key + ".*");
    });

    multi.exec(function(err, results) {
      if (err) throw err;
      var i = 0;
      results.forEach(function(result) {
        process.stdout.write(KEYS[i] + ".*: \t" + result.length + "\n");

        // If possible display one or two key sample.
        if (result.length > 0) {
          process.stdout.write(result[0]);
          process.stdout.write("\n");
        }

        // If possible display one or two key sample.
        if (result.length > 1) {
          process.stdout.write(result[1]);
          process.stdout.write("\n");
        }
        process.stdout.write("\n");
        i++;
      });
      process.exit(0);
    });
  });
}
