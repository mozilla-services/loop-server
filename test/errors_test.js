/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var supertest = require("supertest");

var app = require("../loop").app;

describe("addErrors middlewares", function() {

  var withSendError, withAddErrors, withWrongLocation;

  // Create a route with the attachSession middleware.
  app.post('/with-send-error', function(req, res) {
    res.sendError("url", "token", "invalid token");
  });

  app.post('/with-add-errors', function(req, res) {
      res.addError("url", "token", "invalid token");
      res.addError("querystring", "version", "missing: version");
      res.addError("body", "callerId", "missing: callerId");
      res.sendError();
    });

  app.post('/with-wrong-send-error', function(req, res) {
    res.sendError("wrong location", "test", "error");
  });

  beforeEach(function() {
    withSendError = supertest(app).post("/with-send-error");
    withAddErrors = supertest(app).post("/with-add-errors");
    withWrongLocation = supertest(app).post("/with-wrong-send-error");
  });

  describe("#sendError", function() {
    it("should return a 400 error with one message", function(done) {
      withSendError
        .expect(400)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          expect(res.body).to.have.property("status");
          expect(res.body).to.have.property("errors");
          expect(res.body.errors).to.have.length(1);          
          expect(res.body).eql({
            status: "errors",
            errors: [{location: "url",
                      name: "token",
                      description: "invalid token"}]
          });
          done();
        });
    });
    it("should return a 500 error with wrong location.", function(done) {
      withWrongLocation
        .expect(500)
        .end(function(err, res) {
          expect(res.text, /wrong location/);
          expect(res.text, /is not a valid location/);
          expect(res.text, /Should be header, body, url or querystring./);
          done();
        });
    });
  });

  describe("#addError", function() {
    it("should return a 400 error with three messages", function(done) {
      withAddErrors
        .expect(400)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          expect(res.body).to.have.property("status");
          expect(res.body).to.have.property("errors");
          expect(res.body.errors).to.have.length(3);
          expect(res.body).eql({
            status: "errors",
            errors: [{location: "url",
                      name: "token",
                      description: "invalid token"},
                     {location: "querystring",
                      name: "version",
                      description: "missing: version"},
                     {location: "body",
                      name: "callerId",
                      description: "missing: callerId"}]
          });
          done();
        });
    });
  });
});
