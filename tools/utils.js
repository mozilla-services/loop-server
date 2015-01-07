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

module.exports = {
  keysInformation: keysInformation,
  dbInformation: dbInformation
};
