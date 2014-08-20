/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var supertest = require("supertest");
var expect = require("chai").expect;

var app = require("../loop").app;
var conf = require("../loop").conf;

describe("#headers", function(){

  // Create routes to test the middleware
  app.get('/return200/', function(req, res) {
    res.status(200).json();
  });
  app.get('/return400/', function(req, res) {
    res.status(400).json();
  });
  app.get('/return401/', function(req, res) {
    res.status(401).json();
  });
  app.get('/return503/', function(req, res) {
    res.status(503).json();
  });

  it("should set a Timestamp header when returning a 200 ok.", function(done) {
    supertest(app).get('/return200/').expect(200).end(function(err, res) {
      if (err) {
        throw err;
      }

      expect(res.headers.hasOwnProperty('timestamp')).eql(true);
      done();
    });
  });

  it("should set a Timestamp header when returning a 401.", function(done) {
    supertest(app).get('/return401/').expect(401).end(function(err, res) {
      if (err) {
        throw err;
      }

      expect(res.headers.hasOwnProperty('timestamp')).eql(true);
      done();
    });
  });

  it("should not set a Timestamp header when returning a 400.", function(done) {
    supertest(app).get('/return400/').expect(400).end(function(err, res) {
      if (err) {
        throw err;
      }

      expect(res.headers.hasOwnProperty('x-timestamp')).eql(false);
      done();
    });
  });

  it("should set a Retry-After header when returning a 503.", function(done) {
    supertest(app).get('/return503/').expect(503).end(function(err, res) {
      if (err) {
        throw err;
      }

      expect(res.headers.hasOwnProperty('retry-after')).eql(true);
      expect(res.headers['retry-after']).equal(
        conf.get('retryAfter').toString());
      done();
    });
  });

  it("should not return any X-Powered-By headers..", function(done) {
    supertest(app).get('/return200/').expect(200).end(function(err, res) {
      if (err) {
        throw err;
      }

      expect(res.headers.hasOwnProperty('x-powered-by')).eql(false);
      done();
    });
  });
});
