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
var expect = require("chai").expect;
var conf = loop.conf;
var pjson = require('../package.json');
var os = require("os");


describe("metrics middleware", function() {
  var sandbox;
  var logs = [];
  var old_metrics;

  app.get("/with-metrics-middleware", logMetrics, function(req, res) {
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
      .set('user-agent', 'Mouzilla')
      .set('accept-language', 'Breton du sud')
      .set('x-forwarded-for', 'ip1, ip2, ip3')
      .expect(200)
      .end(function(err, res) {
        var logged = JSON.parse(logs[0]);

        expect(logged.op).to.eql('request.summary');
        expect(logged.code).to.eql(200);
        expect(logged.path).to.eql('/with-metrics-middleware');
        expect(logged.uid).to.eql('uuid');
        expect(logged.agent).to.eql('Mouzilla');
        expect(logged.v).to.eql(pjson.version);
        expect(logged.name).to.eql(pjson.name);
        expect(logged.hostname).to.eql(os.hostname());
        expect(logged.lang).to.eql('Breton du sud');
        expect(logged.ip).to.eql('ip1, ip2, ip3');
        expect(logged.errno).to.eql(0);

        done();
      });
  });
});

