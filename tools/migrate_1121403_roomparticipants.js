/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.

 * Migrate the room participants from the old format to the new one.
 *
 * Previously, a "roomparticipants.{roomToken}" key was holding the list of
 * participants, with their value. The Redis data-type was a hash.
 *
 * Bug 1121403 changed that in order to have expiration events on the
 * participants; the data type is now a set, refering to all the participants
 * ids. Participants details are now stored with their own independent key.
 *
 * This script copies all the old keys to the new format.
 **/

 "use strict";

var async = require('async');
var redis = require("redis");
var conf = require('../loop/config').conf;
var time = require('../loop/utils').time;

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

    client.keys('roomparticipants.*', function(err, keys) {
      if (err) throw err;
      async.each(keys, function(key, done) {
        var roomToken = key.split('.')[1];
        // Access the key using the old format.
        client.hgetall(key, function(err, participants){
          // If we have an error, it means we have the right format already.
          // Skip to the next key.
          if (err) return done();

          // Delete the hash key since we want to replace it with a set.
          client.del(key, function(err) {
            if (err) return done();
            var multi = client.multi();

            async.each(Object.keys(participants), function(id, ok) {
              var participant = JSON.parse(participants[id]);

              var ttl = participant.expiresAt - time();
              delete participant.expiresAt;

              multi.psetex(
                'roomparticipant.' + roomToken + '.' + participant.hawkIdHmac,
                ttl,
                JSON.stringify(participant)
              );
              multi.sadd('roomparticipants.' + roomToken, participant.hawkIdHmac);
              multi.pexpire('roomparticipants.' + roomToken, ttl);
              ok();
            }, function(err) {
              multi.exec(done);
            });
          });
        })
      }, callback);
    })
  }
}

if (require.main === module) {
  main(function() {
    process.exit(0);
  });
}

module.exports = main;
