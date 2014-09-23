var hmac = require('../loop/hmac');
var conf = require('../loop/config').conf;
var redis = require("redis");

var storage = conf.get("storage");

var hawkIdSecret = conf.get("hawkIdSecret");

var argv = require('yargs').argv;

if (argv._.length > 0) {
  var hawkId = argv._[0];
  var hawkIdHmac = hmac(hawkId, hawkIdSecret);
  console.log("redis-cli TTL hawk." + hawkIdHmac);

  if (storage.engine === "redis") {
    var options = storage.settings;
    var client = redis.createClient(
      options.port,
      options.host,
      options.options
    );
    if (options.db) client.select(options.db);

    client.ttl("hawk." + hawkIdHmac, function(err, result) {
      if (err) throw err;
      console.log("expire in", result, "seconds");
      process.exit(0);
    });
  }
} else {
  console.log("USAGE: " + argv.$0 + " hawkId");
}
