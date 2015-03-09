/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var async = require('async');
var expect = require("chai").expect;
var uuid = require('node-uuid');
var sinon = require('sinon');

var loop = require("../loop");
var time = require('../loop/utils').time;
var getStorage = require("../loop/storage");

var moveRedisData = require("../tools/move_redis_data");
var migrateRoomParticipants = require("../tools/migrate_1121403_roomparticipants");
var get_session_id_for_rooms = require("../tools/get_tokbox_sessionid_for_room_token");


var storage = loop.storage;

describe('Tools', function() {

  describe('redis migration', function() {
    var options = {
      engine: "redis",
      settings: {
        "host": "localhost",
        "port": 6379,
        "db": 5,
        "migrateFrom": {
          "host": "localhost",
          "port": 6379,
          "db": 4,
        }
      }
    };

    var storage, range, sandbox;

    beforeEach(function(done) {
      sandbox = sinon.sandbox.create();
      // Mock console.log to not output during the tests.
      sandbox.stub(console, 'log', function(){});

      range = [];
      // Populate the range with a number of items.
      for (var i = 0; i < 200; i++) {
        range.push(i);
      }

      storage = getStorage(options);
      // Add items to the old database.
      var multi = storage._client.old_db.multi();
      range.forEach(function(i) {
        multi.set('old.foo' + i, 'bar');
        multi.setex('old.foofoo' + i, 10, 'barbar');
        multi.hmset('old.myhash' + i, {'foo': 'bar'});
      });

      multi.exec(function(err) {
        if (err) throw err;
        // Add items to the new database.
        var multi = storage._client.new_db.multi();
        range.forEach(function(i) {
          multi.set('new.foo' + i, 'bar');
          multi.setex('new.foofoo' + i, 10, 'barbar');
          multi.hmset('new.myhash' + i, {'foo': 'bar'});
        });
        multi.exec(done);
      });
    });

    afterEach(function(done) {
      sandbox.restore();
      storage._client.old_db.flushdb(function(err) {
        if (err) throw err;
        storage._client.new_db.flushdb(done);
      });
    });

    it("old+new values should be in the new db after migration", function(done){
      moveRedisData(options.settings, function(err, counter) {
        if (err) throw err;
        expect(counter).to.eql(600);
        expect(range).to.length(200);
        // Check old and new values are present.
        async.each(range, function(i, cb) {
          var multi = storage._client.new_db.multi();
          multi.get('old.foo' + i);
          multi.ttl('old.foofoo' + i);
          multi.hmget('old.myhash' + i, 'foo');
          multi.get('new.foo' + i);
          multi.ttl('new.foofoo' + i);
          multi.hmget('new.myhash' + i, 'foo');
          multi.exec(function(err, results) {
            if (err) throw err;
            expect(results[0]).to.eql('bar');
            expect(results[1]).to.be.lte(10);
            expect(results[1]).to.be.gt(0);
            expect(results[2]).to.eql('bar');
            expect(results[3]).to.eql('bar');
            expect(results[4]).to.be.lte(10);
            expect(results[4]).to.be.gt(0);
            expect(results[5]).to.eql('bar');
            cb();
          });
        }, done);
      });
    });

    it("should delete keys from the old database once copied", function(done) {
      moveRedisData(options.settings, function(err) {
        if (err) throw err;
        // Check old and new values are present.
        var multi = storage._client.old_db.multi();
        multi.get('old.foo');
        multi.ttl('old.foofoo');
        multi.hgetall('old.myhash');
        multi.exec(function(err, results) {
          if (err) throw err;
          expect(results[0]).to.eql(null);
          expect(results[1]).to.eql('-2');
          expect(results[2]).to.eql('');
          done();
        });
      });
    });
  });

  describe('room participants migration bug 1121413', function() {
    // Before each test, populate the database with some old data.
    var roomTokens = ['ooByyZNJyEs', 'M6iilFJply8'];
    var participants = {
      '12345': {
        id: uuid.v4(),
        hawkIdHmac: '12345',
        displayName: 'alexis',
        clientMaxSize: 4,
        userMac: 'alexis mac',
        account: 'alexis account'
      },
      '45678': {
        id: uuid.v4(),
        hawkIdHmac: '45678',
        displayName: 'natim',
        clientMaxSize: 4,
        userMac: 'natim mac',
        account: 'natim account'
      }
    };

    beforeEach(function(done) {
      var multi = storage._client.multi();
      roomTokens.forEach(function(token) {
        Object.keys(participants).forEach(function(id) {
          // Deep copy.
          var participant = JSON.parse(JSON.stringify(participants[id]));
          participant.expiresAt = time() + 5000;

          var data = JSON.stringify(participant);
          multi.hset('roomparticipants.' + token, id, data);
        });
      });
      multi.exec(done);
    });

    afterEach(function(done) {
      storage.drop(done);
    });

    it('migrates the old keys to the new format', function(done) {
      migrateRoomParticipants(function(err) {
        if (err) throw err;
        async.each(roomTokens, function(roomToken, ok) {
          storage.getRoomParticipants(roomToken, function(err, dbParticipants) {
            if (err) return ok(err);
            expect(dbParticipants).to.length(2);
            expect(dbParticipants[0]).to.eql(participants['12345']);
            expect(dbParticipants[1]).to.eql(participants['45678']);
            ok();
          });
        }, function(err) {
          if (err) throw err;
          done(err);
        });
      });
    });
  });

  describe('get_tokbox_session_ids_for_room_tokens', function() {
    var roomTokens = ['ooByyZNJyEs', 'M6iilFJply8'];

    beforeEach(function(done) {
      var multi = storage._client.multi();
      roomTokens.forEach(function(token) {
        multi.set('room.' + token, JSON.stringify({sessionId: 'tokbox_' + token}));
      });
      multi.exec(done);
    });

    afterEach(function(done) {
      storage.drop(done);
    });

    it("should return the list of rooms with the sessionId", function(done) {
      get_session_id_for_rooms(storage._client, roomTokens, function(err, results) {
        if (err) throw err;
        expect(results).to.eql({
          'ooByyZNJyEs': 'tokbox_ooByyZNJyEs',
          'M6iilFJply8': 'tokbox_M6iilFJply8'
        });
        done();
      });
    });
  });
});
