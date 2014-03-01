/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var expect = require("chai").expect;
var sinon  = require("sinon");
var request = require("supertest");
var sinon = require("sinon");

var app = require("../loop");
var tokenlib = require("../loop/tokenlib");
var conf = require('../loop/config.js');
var auth = require("../loop/authentication");


describe("HTTP API exposed by the server", function() {
  "use strict";

  var now = 1393595554796;

  describe("POST /call-url", function() {
    var jsonReq, sandbox, expectedAssertion;

    beforeEach(function() {
      sandbox = sinon.sandbox.create();

      expectedAssertion = "BID-ASSERTION";

      jsonReq = request(app)
        .post('/call-url')
        .set('Authorization', 'BrowserID ' + expectedAssertion)
        .type('json')
        .expect('Content-Type', /json/);

      // Mock the calls to the external BrowserID verifier.
      sandbox.stub(auth, "verify", function(assertion, audience, cb){
        if (assertion === expectedAssertion)
          cb(null, "alexis@notmyidea.org", {});
        else
          cb("error");
      });
    });

    afterEach(function() {
      sandbox.restore();
    });

    describe("Authenticated user", function() {
      it("should require simple push url", function(done) {
        jsonReq
          .send({}) // XXX sending nothing fails here, investigate
          .expect(400)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body.error).eql('simple_push_url is required');
            done();
          });
      });

      it("should validate the simple push url", function(done) {
        jsonReq
          .send({'simple_push_url': 'not-an-url'})
          .expect(400)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body.error).eql('simple_push_url should be a valid url');
            done();
          });
      });

      it("should reject non-JSON requests", function(done) {
        request(app)
          .post('/call-url')
          .set('Authorization', 'BrowserID ' + expectedAssertion)
          .type('html')
          .expect(406).end(function(err, res) {
            if (err) throw err;
            expect(res.body).eql(["application/json"]);
            done();
          });
      });

      it("should accept valid browserid assertions", function(done) {
        jsonReq
          .send({simple_push_url: "http://exemple.com"})
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            done();
          });
      });

      it("should generate a valid call-url", function(done) {
        var clock = sinon.useFakeTimers(now);
        var tokenManager = new tokenlib.TokenManager(conf.get('tokenSecret'));

        jsonReq
          .send({simple_push_url: "http://example.com"})
          .expect(200)
          .end(function(err, res) {
            var callUrl = res.body && res.body.call_url, token;

            expect(callUrl).to.not.equal(null);
            expect(callUrl).to.match(/^http:\/\/127.0.0.1/);

            // XXX: the content of the token should change in the
            // future.
            token = callUrl.split("/").pop();
            expect(tokenManager.decode(token)).to.deep.equal({
              expires: now + tokenManager.timeout
            });

            clock.restore();
            done(err);
          });
      });

      it.skip("should store push url", function() {
        // XXX move in a different location.
      });
    });

    describe("Unauthenticated user", function() {
      it("should require user authentication", function(done) {
        request(app)
          .post('/call-url')
          .send({simple_push_url: "http://example.com"})
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
          .send({simple_push_url: "http://exemple.com"})
          .expect(401)
          .end(done);
      });
    });

    it.skip("should attach a session to the user agent", function() {
    });

    it.skip("should store push url", function() {
      // XXX move in a different location.
    });
  });

  describe("GET /calls/{call_token}", function() {
    it.skip("should return a valid HTML page", function() {

    });

    it.skip("should validate the token", function() {

    });
  });

  describe("GET /calls", function() {
    it.skip("should list existing calls", function() {

    });

    it.skip("should require a user session", function() {

    });

    it.skip("should validate a user session", function() {

    });
  });

  describe("POST /calls/{call_token}", function() {
    it.skip("should trigger simple push", function() {

    });

    it.skip("should store incoming call info", function() {
    });

    it.skip("should return provider info", function() {

    });

    it.skip("should accept valid call token", function() {

    });

    it.skip("should reject invalid call token", function() {
    });
  });
});
