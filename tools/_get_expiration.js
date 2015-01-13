var conf = require('../loop/config').conf;
var async = require('async');
var redis = require("redis");

var storage = conf.get("storage");

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

  client.keys("*", function(err, keys){
    if (err) throw err;
    console.log("processing", keys.length, "keys");

    var multi = client.multi();
    var multi2 = client.multi();

    keys.forEach(function(key) {
      if (key) {
        multi.ttl(key);
        multi2.debug("object", key);
      }

    });
    multi.exec(function(err, ttls) {
      if (err) throw err;

      multi2.exec(function(err, sizes) {
        if (err) throw err;

        var expirations = {};
        var key_sizes = {};

        if (verbose && ttls.indexOf(-1) !== -1) {
          console.log("Keys that will never expires:");
        }

        for(var i = 0; i < keys.length; i++) {
          var ttl = ttls[i];
          var size = parseInt(sizes[i].split(' ')[4].split(':')[1], 10);

          if (ttl == -1) {
            expirations.never = expirations.never ? expirations.never +1 : 1;
            key_sizes.never = key_sizes.never ? key_sizes.never + size : size;
            if (verbose) {
              console.log(keys[i]);
            }
          } else {
            var day = new Date(Date.now() + ttl * 1000).toDateString();
            expirations[day] = expirations[day] ? expirations[day] + 1 : 1;
            key_sizes[day] = key_sizes[day] ? key_sizes[day] + size : size;
          }
        }

        var expiration_keys = Object.keys(expirations);
        expiration_keys.sort(function(a, b) {
          if (a === "never") {
            return -1;
          } else if (b === "never") {
            return 1;
          } else {
            var date_a = new Date(a);
            var date_b = new Date(b);
            return date_a.getTime() - date_b.getTime();
          }
        });

        var today = new Date();
        var cumulative = 0;
        expiration_keys.forEach(function(key) {
          if (key === "never") {
            console.log(expirations[key] + " keys will never expires. (" + key_sizes[key] + " Bytes)");
          } else {
            var date = new Date(key);
            var nb_days = parseInt((date.getTime() - today.getTime()) / (24 * 3600 * 1000), 10) + 1;
            cumulative += expirations[key];
            console.log(date.getUTCFullYear() + "/" + (date.getUTCMonth() + 1) + "/" + date.getUTCDate() + "\t" + expirations[key] + "\t" + cumulative + "\t" + (key_sizes[key]) + " Bytes\t(in " + nb_days + " days)");
          }
        });
        process.exit(0);
      });
    });
  });
}
