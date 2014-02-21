/* global it, describe */

var expect = require("chai").expect;
var request = require("supertest");

var app = require("../loop");

describe("HTTP API exposed by the server", function() {
  "use strict";
  var req;

  beforeEach(function(){
    req = request(app)
            .post('/call-url')
            .set('Accept', 'application/json')
            .expect('Content-Type', /json/);
  });

  describe("POST /call-url", function() {
    it("should require simple push url", function() {
      req.expect(400).end(function(err, res){
        if (err) throw err;
        expect(res.body.error).eql('simple_push_url is required');
      });
    });

    it.skip("should validate the simple push url", function() {
      
    });

    it.skip("should attach a session to the user agent", function() {

    });

    it.skip("should generate a valid call-url", function() {

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
