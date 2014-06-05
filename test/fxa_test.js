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

describe("fxa authentication", function() {
  var sandbox;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('middleware', function() {
    var jsonReq, expectedAssertion;

    // Create a route with the auth middleware installed.
    app.post('/with-middleware',
      fxa.getMiddleware("audience", function(req, res, assertion, next) {
        req.user = assertion.email;
        next();
      }), function(req, res) {
      res.json(200, req.user);
    });

    beforeEach(function() {
      jsonReq = supertest(app)
        .post('/with-middleware');

      expectedAssertion = "BID-ASSERTION";

      // Mock the calls to the external BrowserID verifier.
      sandbox.stub(fxa, "verifyAssertion",
        function(assertion, audience, trustedIssuers, cb){
          if (assertion === expectedAssertion) {
            cb(null, {email: user});
          } else {
            cb("error");
          }
        });
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

  describe('#verifyAssertion', function() {
    var assertion;
    beforeEach(function() {
      assertion = {
        "audience": "https://loop.firefox.com",
        "expires": 1389791993675,
        "issuer": "msisdn.accounts.firefox.com",
        "email": "4c352927cd4f4a4aa03d7d1893d950b8@msisdn.accounts.firefox.com",
        "status": "okay"
      };
    });

    it("should return an error if the verifier errored", function() {
      sandbox.stub(fxa.request, "post", function(opts, cb) {
        cb(null, "message", {
          status: "error",
          reason: "something bad"
        });
      });
      fxa.verifyAssertion("assertion", "audience", ["trustedIssuer"],
        function(err, data) {
          expect(err).eql("something bad");
        });
    });

    it("should return an error if the verifier is not responding", function() {
      sandbox.stub(fxa.request, "post", function(opts, cb) {
        cb("error", null, null);
      });
      fxa.verifyAssertion("assertion", "audience", ["trusted-issuer"],
        function(err, data) {
          expect(err).eql("error");
        });
    });

    it("should not accept untrusted issuers", function() {
      assertion.issuer = "untrusted-issuer";
      sandbox.stub(fxa.request, "post", function(opts, cb) {
        cb(null, null, assertion);
      });

      fxa.verifyAssertion("assertion", "audience", ["trusted-issuer"],
        function(err, data) {
          expect(err).eql("Issuer is not trusted");
        });
    });

    it("should accept trusted issuers", function() {
      assertion.issuer = "trusted-issuer";
      sandbox.stub(fxa.request, "post", function(opts, cb) {
        cb(null, null, assertion);
      });

      fxa.verifyAssertion("assertion", "audience", ["trusted-issuer"],
        function(err, data) {
          expect(err).eql(null);
          expect(data).eql(assertion);
        });
    });
  });
});
