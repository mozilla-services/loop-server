/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var supertest = require("supertest");
var tokenlib = require("../loop/tokenlib");

var app = require("../loop").app;
var conf = require("../loop").conf;
var hmac = require("../loop").hmac;
var validateSimplePushURL = require("../loop").validateSimplePushURL;
var validateToken = require("../loop").validateToken;


describe("index", function() {
  var jsonReq;

  beforeEach(function() {
    jsonReq = supertest(app);
  });

  describe("#hmac", function() {

    it("should raise on missing secret", function(done) {
      expect(function() {
          hmac("Payload");
        }).to.throw(/provide a secret./);
      done();
    });

    it("should have the same result for the same payload", function(done){
      var firstTime = hmac("Payload", conf.get("userMacSecret"));
      expect(hmac("Payload", conf.get("userMacSecret"))).to.eql(firstTime);
      done();
    });

    it("should handle the algorithm argument", function(done){
      expect(hmac(
        "Payload",
        conf.get("userMacSecret"),
        "sha1")).to.have.length(40);
      done();
    });
  });

  describe("#validateSimplePushURL", function(){
    it("should receive an object", function(done){
      expect(validateSimplePushURL).to.throw(/missing request data/);
      done();
    });

    it("should receive a SimplePush URL", function(done){
      expect(function(){
        validateSimplePushURL({});
      }).to.throw(/simple_push_url is required/);
      done();
    });

    it("should receive a valid HTTP URL", function(done){
      expect(function(){
        validateSimplePushURL({simple_push_url: "Wrong URL"});
      }).to.throw(/simple_push_url should be a valid url/);
      done();
    });

    it("should handle valid SimplePush URL", function(done){
      expect(validateSimplePushURL({
        simple_push_url: "http://www.mozilla.org"
      })).to.eql({
        simple_push_url: "http://www.mozilla.org"
      });
      done();
    });
  });

  describe("#validateToken", function(){
    // Create a route with the validateToken middleware installed.
    app.get('/validateToken/:token', validateToken, function(req, res) {
      res.json(200, "ok");
    });

    it("should return a 404 if the token is missing.", function(done) {
      jsonReq
        .get('/validateToken/')
        .expect(404)
        .end(done);
    });

    it("should return a 400 if the token is invalid.", function(done) {
      jsonReq
        .get('/validateToken/invalidToken/')
        .expect(400, /invalid token/)
        .end(done);
    });

    it("should return a 200 if the token is valid.", function(done) {
      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });

      var token = tokenManager.encode({
        uuid: "1234",
        user: "natim"
      });

      jsonReq
        .get('/validateToken/' + token)
        .expect(200, /ok/)
        .end(done);
    });
  });
});
