var hmac = require('../loop/hmac');
var conf = require('../loop/config').conf;

var hawkIdSecret = conf.get("hawkIdSecret");

var argv = require('yargs').argv;

if (argv._.length > 0) {
  var hawkId = argv._[0];
  console.log("redis-cli TTL hawk." + hmac(hawkId, hawkIdSecret));
} else {
  console.log("USAGE: " + argv['$0'] + " hawkId");
}
