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

    var multi = client.multi();
    multi.keys("userid.*");
    multi.keys("hawkuser.*");
    multi.exec(function (err, results) {
      if (err) throw err;
      callback({
        total: results[0].length,
        count: results[1].length
      });
    });
  }
}


if (require.main === module) {
  main(function(results) {
    process.stdout.write(results.count + " FxA users for " +
                         results.total + " users.");
    process.exit(0);
  });
}

module.exports = main;
