/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var expect = require("chai").expect;

var getClient = require("../loop/storage/redis_migration");
var conf = require("../loop").conf;
var async = require("async");

describe("redis migration", function() {
  var client;
  beforeEach(function() {
    var options = {
      oldDB: conf.get('storage').settings,
      newDB: { db: 4 }
    };
    client = getClient(options)
  });
  afterEach(function(done){
    client.old_db.flushdb(function(){
      client.new_db.flushdb(function(){
        done();
      });
    });
  });
  it("should copy a key from the old db if it exists", function(done) {
    client.old_db.set('key', 'value', function(err){
      if (err) throw err;
      client.old_db.expire('key', 2, function(err){
        if (err) throw err;
        client.get('key', function(err, data) {
          if (err) throw err;
          expect(data).to.eql('value');
          client.new_db.get('key', function(err, data) {
            if (err) throw err;
            expect(data).to.eql('value')
            // Check it preserves the TTL info.
            client.new_db.pttl('key', function(err, ttl) {
              if (err) throw err;
              expect(ttl).to.gte(1500);
              expect(ttl).to.lte(2000);
              // Ensure the old value is deleted properly.
              client.old_db.get('key', function(err, data){
                if (err) throw err;
                expect(data).to.eql(null);
                done();
              });
            });
          });
        });
      });
    });
  });

  it("should copy all keys in case there is a '*' in the key", function(done) {
    // Let's create a bunch of keys in the old database
    async.each(
      ['key1', 'key2', 'key3', 'key4'],
      function(key, callback){
        client.old_db.set(key, 'value', callback);
      },
      function(){
        client.keys('key*', function(err, keys){
          expect(keys).to.length(4);
          if (err) throw err;
          client.mget(keys, function(err, values){
            if (err) throw err;
            expect(values).to.eql(['value', 'value', 'value', 'value']);
            done();
          });
        });
      });
  });

  describe("with env set to prod", function() {
    var env;
    beforeEach(function(){
      env = conf.get('env')
      conf.set('env', 'prod');
    });

    afterEach(function() {
      conf.set('env', env);
    });

    it("should not flush the db even if asked for", function(done) {
      client.set("key", "value", function(err) {
        if (err) throw err;
        client.flushdb(function(err) {
          if (err) throw err;
          client.get("key", function(err, result) {
            if (err) throw err;
            expect(result).to.eql("value");
            done();
          });
        });
      });
    });
  });
});
