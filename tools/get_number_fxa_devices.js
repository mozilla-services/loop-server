var conf = require('../loop/config').conf;
var redis = require("redis");

var storage = conf.get("storage");

function main(callback) {
  if (storage.engine === "redis") {
    var options = storage.settings;
    var client = redis.createClient(
      options.port,
      options.host,
      options.options
    );
    if (options.db) client.select(options.db);

    client.keys('hawkuser.*', function(err, keys) {
      if (err) throw err;
      var multi = client.multi();
      
      keys.forEach(function(key) {
        multi.get(key);
      });
      
      multi.exec(function(err, results) {
        var users = {};

        results.forEach(function(result, index) {
          if(!users.hasOwnProperty(result)) {
            users[result] = 1;
          } else {
            users[result]++;
          }
        });

        var total = Object.keys(users).length;
        var max = 0;
        var sum = 0;
        for(var key in users) {
          sum += users[key];
          if (max < users[key]) {
            max = users[key];
          }
        }

        
        callback({
          users: total,
          average: sum/total,
          max: max
        });
      });      
    });
  }
}


if (require.main === module) {
  main(function(results) {
    process.stdout.write(results.users + " FxA users with " +
                         results.average + " devices in average and a maximum of " + results.max + ".\n");
    process.exit(0);
  });
}

module.exports = main;
