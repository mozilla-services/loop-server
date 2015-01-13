var fs = require('fs'),
    rl = require('readline');

function keysInformation(client, pattern, callback) {
  if (callback === undefined) {
    callback = pattern;
    pattern = '*';
  }

  client.keys(pattern, function(err, keys){
    if (err) return callback(err);

    var multi = client.multi();

    keys.forEach(function(key) {
      if (key) {
        multi.debug("object", key);
      }

    });
    multi.exec(function(err, objects) {
      if (err) return callback(err);
      var results = [];

      for(var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var obj = objects[i].split(" ");
        var data = {key: key};
        obj.forEach(function(value) {
          var keyVal = value.split(":");
          if (keyVal.length === 2) {
            data[keyVal[0]] = keyVal[1];
          }
        });
        results.push(data);
      }

      callback(null, results);
    });
  });
}

function dbInformation(client, db, callback) {
  if (callback === undefined) {
    callback = db;
    db = undefined;
  }

  client.info("keyspace", function(err, info) {
    if (err) return callback(err);

    info.split("\n").forEach(function(line) {
      if (line.indexOf("db" + (db || 0)) === 0) {
        var info = {};
        line.split(":")[1].split(",").forEach(function(value) {
          var keyVal = value.split("=");
          info[keyVal[0]] = parseInt(keyVal[1], 10);
        });
        return callback(null, info);
      }
    });
  });
}


/**
 * github.com/bucaran/sget
 *
 * sget. Async / Sync read line for Node.
 *
 * @copyright (c) 2014 Jorge Bucaran
 * @license MIT
 */
/**
 * Read a line from stdin sync. If callback is undefined reads it async.
 *
 * @param {String} message Message to log before reading stdin.
 * @param {Function} callback If specified, reads the stdin async.
 */
var sget = function(message, callback) {
  win32 = function() {
    return ('win32' === process.platform);
  },
  readSync = function(buffer) {
    var fd = win32() ? process.stdin.fd : fs.openSync('/dev/stdin', 'rs');
    var bytes = fs.readSync(fd, buffer, 0, buffer.length);
    if (!win32()) fs.closeSync(fd);
    return bytes;
  };
  message = message || '';
  if (callback) {
    var cli = rl.createInterface(process.stdin, process.stdout);
    console.log(message);
    cli.prompt();
    cli.on('line', function(data) {
      cli.close();
      callback(data);
    });
  } else {
    return (function(buffer) {
      try {
        console.log(message);
        return buffer.toString(null, 0, readSync(buffer));
      } catch (e) {
        throw e;
      }
    }(new Buffer(sget.bufferSize)));
  }
};
/**
 * @type {Number} Size of the buffer to read.
 */
sget.bufferSize = 256;


module.exports = {
  keysInformation: keysInformation,
  dbInformation: dbInformation,
  sget: sget
};
