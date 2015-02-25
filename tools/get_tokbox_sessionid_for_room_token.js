var readline = require('readline');
var conf = require('../loop/config').conf;
var redis = require('redis');

var storage = conf.get('storage');
var args = process.argv.slice(2);
var verbose = args.indexOf('--verbose') !== -1;

if (storage.engine === 'redis') {
  var options = storage.settings;
  var client = redis.createClient(
    options.port,
    options.host,
    options.options
  );
  if (options.db) client.select(options.db);

  console.log('Please enter a roomToken per line. Ctrl+D to stop.');

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  var multi = client.multi();
  var roomTokens = [];

  rl.on('line', function (roomToken) {
    roomTokens.push(roomToken);
    multi.get('room.' + roomToken);
  });

  rl.on('close', function() {
    multi.exec(function(err, results) {
      if (err) throw err;

      var output = {};

      for (var i=0; i < results.length; i++) {
        if (results[i] !== null) {
          output[roomTokens[i]] = JSON.parse(results[i]).sessionId;
        }
      }
      console.log(JSON.stringify(output));
      process.exit(0);
    });
  });
}
