/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var ws = require('ws');
var server = require("../loop").server;

describe.skip('websockets', function() {
  var client;
  beforeEach(function(done) {
    client = new ws("ws://localhost:" + server.address().port);
    done();
  });

  afterEach(function(done) {
    client.on('close', function() { done(); });
    client.close();
  });

  it('should listen on the same port the app does', function(done) {
    client.on('open', function() {
      done();
    });
  });

  it('should reject bad authentication tokens', function(done) {
    client.on('open', function() {
      client.on('error', function(error) {
        expect(error).eql('wrong authentication token');
        done();
      });
      client.send(JSON.stringify({
        messagetype: 'hello',
        auth: '1234',
        callId: '1234'
      }));
    });
  });
});
