/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var supertest = require("supertest");
var sinon = require("sinon");

var app = require("../loop").app;
var fxa = require("../loop/fxa");
var user = "alexis@notmyidea.org";

describe("authentication middleware", function() {
  var jsonReq, expectedAssertion, sandbox;

  // Create a route with the auth middleware installed.
  app.post('/with-middleware',
    fxa.getMiddleware("audience", function(req, res, assertion, next) {
      req.user = assertion.email;
      next();
    }), function(req, res) {
    res.json(200, req.user);
  });

  beforeEach(function() {
    sandbox = sinon.sandbox.create();

    jsonReq = supertest(app)
      .post('/with-middleware');

    expectedAssertion = "BID-ASSERTION";

    // Mock the calls to the external BrowserID verifier.
    sandbox.stub(fxa, "verify", function(assertion, audience, cb){
      if (assertion === expectedAssertion) {
        cb(null, user, {email: user});
      } else {
        cb("error");
      }
    });
  });

  afterEach(function() {
    sandbox.restore();
  });

  it("should require user authentication", function(done) {
    jsonReq
      .expect(401)
      .end(function(err, res) {
        if (err) throw err;
        expect(res.headers['www-authenticate']).to.eql('BrowserID');
        done();
      });
  });

  it("should reject invalid browserid assertions", function(done) {
    // Mock the calls to the external BrowserID verifier.
    jsonReq
      .set('Authorization', 'BrowserID ' + "invalid-assertion")
      .expect(401)
      .end(done);
  });

  it("should accept valid browserid assertions", function(done) {
    jsonReq
      .set('Authorization', 'BrowserID ' + expectedAssertion)
      .expect(200)
      .end(function(err, res) {
        if (err) throw err;
        done();
      });
  });

  it("should set an 'user' property on the request object", function(done) {
    jsonReq
      .set('Authorization', 'BrowserID ' + expectedAssertion)
      .expect(200)
      .end(function(err, res) {
        if (err) throw err;
        expect(res.body).eql("alexis@notmyidea.org");
        done();
      });
  });
});
