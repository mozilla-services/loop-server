/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var supertest = require("supertest");

var app = require("../loop").app;
var sessions = require("../loop/sessions");


describe("sessions middlewares", function() {

  var withSession, withSessionRequired, sessionCookie;

  // Create a route with the attachSession middleware.
  app.post('/with-session', sessions.attachSession,
    function(req, res) {
      res.json(200);
    });

  // Create a route with the requireSession middleware.
  app.post('/with-session-required', sessions.requireSession,
    function(req, res) {
      res.json(200);
    });

  beforeEach(function(done) {
    withSession = supertest(app).post("/with-session");
    withSessionRequired = supertest(app).post("/with-session-required");

    supertest(app).get('/get-cookies').end(function(err, res) {
      sessionCookie = res.headers['set-cookie'][0];
      done(err);
    });

  });

  it("should accept a valid session cookie", function(done) {
    withSessionRequired.set('Cookie', sessionCookie).expect(200).end(done);
  });

  it("should return an error if there is no session", function(done) {
    withSessionRequired.expect(400).end(done);
  });

  it("should attach a session cookie if none is provided", function(done) {
    withSession
      .expect("Set-Cookie", /^loop-session=/)
      .expect(200).end(function(err, res) {
        expect(res.headers["set-cookie"][0]).to.not.equal(sessionCookie);
        done(err);
      });
  });

  it("should not attach a new cookie if one is provided", function(done) {
    withSession
      .set('Cookie', sessionCookie)
      .expect(200).end(function(err, res) {
        expect(res.headers["set-cookie"]).to.equal(undefined);
        done(err);
      });
  });

});
