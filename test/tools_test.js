/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var async = require('async');
var expect = require("chai").expect;
var uuid = require('node-uuid');

var loop = require("../loop");
var migrate = require("../tools/migrate_1121403_roomparticipants");
var time = require('../loop/utils').time;


var storage = loop.storage;

describe('Tools', function() {

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
      migrate(function(err) {
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
  })
});
