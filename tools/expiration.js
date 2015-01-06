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

  client.keys("*", function(err, keys){
    if (err) throw err;
    console.log("processing", keys.length, "keys");

    var multi = client.multi();
    keys.forEach(function(key) {
      if (key) {
        multi.ttl(key);
      }
    });
    multi.exec(function(err, results) {
      if (err) throw err;

      var today = new Date();
      var day_before_eow = 7 - today + 1;
      var end_of_week = parseInt(Date.now() / 1000, 10) + day_before_eow * 3600;
      var end_of_next_week = end_of_week + 7 * 3600;

      var nb_eow = 0,
          nb_eonw = 0,
          other = 0;
          never = 0;

      results.forEach(function(ttl) {
        if (ttl == -1) {
          never++;
        } else if (ttl <= end_of_week) {
          nb_eow++;
        } else if (ttl <= end_of_next_week) {
          nb_eonw++;
        } else {
          other++;
        }
      });
      
      console.log(never + " keys will never expire.");
      console.log(nb_eow + " keys will expire before this sunday.");
      console.log(nb_eonw + " keys will expire between this sunday and next sunday.");
      console.log(other + " keys will expire later.")
      
      process.exit(0);
    });
  });
}
