var hmac = require('../loop/hmac');
var conf = require('../loop/config').conf;
var async = require('async');
var redis = require("redis");

var storage = conf.get("storage");
var hawkIdSecret = conf.get("hawkIdSecret");

var args = process.argv.slice(2);

if (args.indexOf('--help') >= 0) {
  console.log("USAGE: " + process.argv.slice(0, 2).join(' ') + " [--delete]");
  process.exit(0);
}

var delKeys = false;

if (args.indexOf('--delete') >= 0) {
  delKeys = true;
}


if (storage.engine === "redis") {
  var options = storage.settings;
  var client = redis.createClient(
    options.port,
    options.host,
    options.options
  );
  if (options.db) client.select(options.db);

  var toDelete = [];

  client.keys("userid.*", function(err, keys){
    console.log("processing", keys.length, "keys");
    async.map(keys, function(key, done) {
      var hawkUserKey = key.replace("userid", "hawkuser")
      client.ttl(hawkUserKey, function(err, ttl) {
        var isImpacted = ttl === -2;
        if (isImpacted) {
          if (delKeys) {
            // Remove the impacted userid
            toDelete.push(key);
            // Remove the session
            toDelete.push(key.replace("userid", "hawk"));
          }

          process.stdout.write("i"); // This is an impacted user.
        } else {
          process.stdout.write(".");
        }
        done(null, isImpacted);
      });
    }, function(err, results){
      var impacted = results.reduce(function(total, current) {
        return total + (current === true);
      }, 0);

      console.log('\nnumber of impacted users', impacted, "over", results.length);

      if (delKeys === true) {
        client.del(toDelete, function(err) {
          console.log('\nThe keys have been removed from the database');
          process.exit(0);

        });
      } else {
        process.exit(0);
      }
    });
  });
}
