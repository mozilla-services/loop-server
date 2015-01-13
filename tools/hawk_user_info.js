var hmac = require('../loop/hmac');
var conf = require('../loop/config').conf;
var decrypt = require('../loop/encrypt').decrypt;
var redis = require("redis");

var storage = conf.get("storage");

var hawkIdSecret = conf.get("hawkIdSecret");

var argv = require('yargs').argv;

if (argv._.length > 0) {
  if (storage.engine === "redis") {
    var options = storage.settings;
    var client = redis.createClient(
      options.port,
      options.host,
      options.options
    );
    if (options.db) client.select(options.db);

    var getInfo = function(hawkId, hawkIdHmac, callback) {
      var multi = client.multi();
      console.log("Trying with HawkIdHmac: " + hawkIdHmac);

      multi.get("hawk." + hawkIdHmac);
      multi.get("hawkuser." + hawkIdHmac);

      multi.exec(function(err, results) {
        if (err) throw err;
        if (results[0] === null) {
          return callback(null, null);
        }
        client.get("userid." + hawkIdHmac, function(err, encryptedUserId) {
          if (err) return callback(err);
          if (encryptedUserId === null) {
            return callback(null, {
              anonymous: true
            });
          }
          var userId;
          if (hawkId) {
            try {
              userId = decrypt(hawkId, encryptedUserId);
            } catch (e) {}
          }
          callback(null, {
            anonymous: false,
            userId: userId || "<ciphered>"
          });
        });
      });
    };

    var displayInfo = function(err, info) {
      if (info === null) {
        console.log("No information found for this hawkIdHmac.");
      } else {
        console.log(info);
      }
      process.exit(0);
    };

    var hawkId = argv._[0];
    var hawkIdHmac = hmac(hawkId, hawkIdSecret);

    getInfo(hawkId, hawkIdHmac, function(err, info) {
      if (err) throw err;
      if (info === null) {
        getInfo(null, hawkId, displayInfo);
        return;
      }
      displayInfo(null, info);
    });
  }
} else {
  console.log("USAGE: " + argv.$0 + " hawkId || hawkIdHmac");
}
