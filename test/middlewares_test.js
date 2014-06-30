/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var addHawk = require("superagent-hawk");
var supertest = addHawk(require("supertest"));
var sinon = require("sinon");
var loop = require("../loop");
var app = loop.app;
var logMetrics = require("../loop/middlewares").logMetrics;
var assert = require("chai").assert;
var conf = loop.conf;
var pjson = require('../package.json');
var os = require("os");


describe("metrics middleware", function() {
  var sandbox;
  var logs = [];
  var old_metrics;

  app.get("/with-metrics-middleware", logMetrics, function(req, res) {
    req.headers['user-agent'] = 'Mouzilla';
    req.headers['accept-language'] = 'Breton du sud';
    req.headers['x-forwarded-for'] = 'ip1, ip2, ip3';
    req.user = 'uuid';
    req.callUrlData = 'data';
    res.json(200, "ok");
  });

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    old_metrics = conf.get('metrics');
    conf.set('metrics', true);
    sandbox.stub(console, "log", function(log) {
      logs.push(log);
    });
  });

  afterEach(function() {
    sandbox.restore();
    conf.set('metrics', old_metrics);
  });


  it("should write logs to stdout", function(done) {
    supertest(app)
      .get('/with-metrics-middleware')
      .expect(200)
      .end(function(err, res) {
        var logged = JSON.parse(logs[0]);

        assert.equal(logged.op, 'request.summary');
        assert.equal(logged.code, 200);
        assert.equal(logged.path, '/with-metrics-middleware');
        assert.equal(logged.user, 'uuid');
        assert.equal(logged.agent, 'Mouzilla');
        assert.equal(logged.callUrlData, 'data');
        assert.equal(logged.v, pjson.version);
        assert.equal(logged.name, pjson.name);
        assert.equal(logged.hostname, os.hostname());
        assert.equal(logged.lang, 'Breton du sud');
        assert.equal(logged.ip, 'ip1, ip2, ip3');

        done();
      });
  });
});

