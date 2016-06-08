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

        results.forEach(function(result) {
          if(!users.hasOwnProperty(result)) {
            users[result] = 1;
          } else {
            users[result]++;
          }
        });

        var total = Object.keys(users).length;
        var max = 0;
        var sum = 0;
        var moreThan1 = 0;
        for(var key in users) {
          sum += users[key];
          if (users[key] > 1) {
            moreThan1++;
          }
          if (max < users[key]) {
            max = users[key];
          }
        }


        callback({
          users: total,
          average: sum/total,
          max: max,
          moreThan1: moreThan1
        });
      });
    });
  }
}


if (require.main === module) {
  main(function(results) {
    process.stdout.write(results.users + " FxA users with " +
                         results.average + " devices on average and a maximum of " + results.max + ", ");
    process.stdout.write("and " + results.moreThan1 + " FxA users with more than one device.\n");
    process.exit(0);
  });
}

module.exports = main;
