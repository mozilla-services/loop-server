var hmac = require('../loop/hmac');
var conf = require('../loop/config').conf;
var async = require('async');
var redis = require("redis");

var storage = conf.get("storage");

var hawkIdSecret = conf.get("hawkIdSecret");

if (storage.engine === "redis") {
  var options = storage.settings;
  var client = redis.createClient(
    options.port,
    options.host,
    options.options
  );
  if (options.db) client.select(options.db);

  client.keys("userid.*", function(err, keys){
    console.log("processing", keys.length, "keys");
    async.map(keys, function(key, done) {
      client.ttl(key.replace("userid", "hawkuser"), function(err, ttl) {
        if (ttl === -2) {
          process.stdout.write("i"); // This is an impacted user.
        } else {
          process.stdout.write(".");
        }
        done(null, ttl === -2);
      });
    }, function(err, results){
      var impacted = results.reduce(function(total, current){ return total + (current === true)}, 0)
      console.log('\nnumber of impacted users', impacted, "over", results.length);
      process.exit(0);
    });
  });
}
