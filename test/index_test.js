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
var urlsRevocationStore = require("../loop").urlsRevocationStore;
var validateToken = require("../loop").validateToken;
var requireParams = require("../loop").requireParams;

describe("index.js", function() {
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

  describe("#validateToken", function(){

    // Create a route with the validateToken middleware installed.
    app.get('/validateToken/:token', validateToken, function(req, res) {
      res.json(200, "ok");
    });

    afterEach(function(done) {
      urlsRevocationStore.drop(function() {
        done();
      });
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

    it("should return a 400 if the token had been revoked", function(done) {
      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });
      var token = tokenManager.encode({
        uuid: "1234",
        user: "natim"
      }).token;
      urlsRevocationStore.add({uuid: "1234"}, function(err) {
        if (err) {
          throw err;
        }
        jsonReq
          .get('/validateToken/' + token)
          .expect(400, /invalid token/)
          .end(done);
      });
    });

    it("should return a 200 if the token is valid.", function(done) {
      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });

      var token = tokenManager.encode({
        uuid: "1234",
        user: "natim",
        callerId: "alexis"
      }).token;

      jsonReq
        .get('/validateToken/' + token)
        .expect(200, /ok/)
        .end(done);
    });
  });

  describe("#requireParams", function(){
    // Create a route with the requireParams middleware installed.
    app.post('/requireParams/', requireParams('a', 'b'), function(req, res) {
      res.json(200, "ok");
    });

    it("should return a 406 if the body is not in JSON.", function(done) {
      jsonReq
        .post('/requireParams/')
        .set('Accept', 'text/html')
        .expect(406, /json/)
        .end(done);
    });

    it("should return a 400 if one of the required params are missing.",
      function(done) {
        jsonReq
          .post('/requireParams/')
          .send({a: "Ok"})
          .expect(400)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).eql({
              status: "errors",
              errors: [{location: "body",
                        name: "b",
                        description: "missing: b"}]
            });
            done();
          });
      });

    it("should return a 400 if all params are missing.", function(done) {
      jsonReq
        .post('/requireParams/')
        .send({})
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.body).eql({
            status: "errors",
            errors: [{location: "body",
                      name: "a",
                      description: "missing: a"},
                     {location: "body",
                      name: "b",
                      description: "missing: b"}]
          });
          done();
        });
    });

    it("should return a 200 if all the params are presents.", function(done) {
      jsonReq
        .post('/requireParams/')
        .send({a: "Ok", b: "Ok"})
        .expect(200)
        .end(done);
    });
  });
});
