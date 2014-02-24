/* global it, describe */

var expect = require("chai").expect;
var request = require("supertest");

var app = require("../loop");
var tokenlib = require("../loop/tokenlib");

var SECRET = "this is not a secret";

describe("HTTP API exposed by the server", function() {
  "use strict";

  describe("POST /call-url", function() {
    var jsonReq;

    beforeEach(function() {
      jsonReq = request(app)
                  .post('/call-url')
                  .type('json')
                  .expect('Content-Type', /json/);
    });

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
        .type('html')
        .expect(406).end(function(err, res) {
          if (err) throw err;
          expect(res.body).eql(["application/json"]);
          done();
        });
    });

    it.skip("should attach a session to the user agent", function() {
    });

    it("should generate a valid call-url", function(done) {
      var tokenManager = new tokenlib.TokenManager(SECRET);

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
          expect(tokenManager.decode(token)).to.deep.equal({});

          done(err);
        });
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
