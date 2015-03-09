var readline = require('readline');
var conf = require('../loop/config').conf;
var redis = require('redis');

var storage = conf.get('storage');
var args = process.argv.slice(2);
var verbose = args.indexOf('--verbose') !== -1;

function get_session_id_for_rooms(client, roomTokens, callback) {
  var multi = client.multi();

  roomTokens.forEach(function(roomToken) {
    multi.get('room.' + roomToken);
  });
  multi.exec(function(err, results) {
    if (err) return callback(err);

    var output = {};
    results.forEach(function(result, i) {
      if (result !== null) {
        output[roomTokens[i]] = JSON.parse(result).sessionId;
      }
    });
    callback(null, output);
  });
}

if (require.main === module && storage.engine === 'redis') {
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

  var roomTokens = [];

  rl.on('line', function (roomToken) {
    roomTokens.push(roomToken);
  });

  rl.on('close', function() {
    get_session_id_for_rooms(client, roomTokens, function(err, output) {
      if (err) throw err;
      console.log(JSON.stringify(output));
      process.exit(0);
    });
  });
}

module.exports = get_session_id_for_rooms;
