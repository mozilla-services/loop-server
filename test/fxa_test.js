/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var supertest = require("supertest");
var sinon = require("sinon");

var loop = require("../loop");
var app = loop.app;
var apiRouter = loop.apiRouter;
var apiPrefix = loop.apiPrefix;
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
    apiRouter.post('/with-middleware',
      fxa.getMiddleware("audience", function(req, res, assertion, next) {
        req.user = assertion.email;
        next();
      }), function(req, res) {
      res.status(200).json(req.user);
    });

    beforeEach(function() {
      jsonReq = supertest(app)
        .post(apiPrefix + '/with-middleware');

      expectedAssertion = "BID-ASSERTION";

      // Mock the calls to the external BrowserID verifier.
      sandbox.stub(fxa, "verifyAssertion",
        function(assertion, audience, trustedIssuers, callback){
          if (assertion === expectedAssertion) {
            callback(null, {email: user});
          } else {
            callback("invalid assertion \"1a2w3e4r5t6y\"");
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
        .end(function(err, res) {
          if (err) throw err;
          expect(res.headers['www-authenticate'])
            .to.eql('BrowserID error="invalid assertion \"1a2w3e4r5t6y\""');
          done();
        });
    });

    it("should accept valid browserid assertions", function(done) {
      jsonReq
        .set('Authorization', 'BrowserID ' + expectedAssertion)
        .expect(200)
        .end(function(err) {
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
    var audience, assertion;
    beforeEach(function() {
      audience = "https://loop.firefox.com";
      assertion = {
        "audience": audience,
        "expires": 1389791993675,
        "issuer": "msisdn.accounts.firefox.com",
        "email": "4c352927cd4f4a4aa03d7d1893d950b8@msisdn.accounts.firefox.com",
        "status": "okay"
      };
      sandbox.stub(fxa, "getAssertionAudience", function() {
        return audience;
      });
    });

    it("should throw if audiences is not an array", function() {
      var failure = function() {
        fxa.verifyAssertion("assertion", "not an array");
      };
      expect(failure).to.Throw(/should be an array/);
    });

    it("should return an error if the verifier errored", function() {
      sandbox.stub(fxa.request, "post", function(opts, callback) {
        callback(null, "message", {
          status: "error",
          reason: "something bad"
        });
      });
      fxa.verifyAssertion("assertion", [audience], ["trustedIssuer"],
        function(err) {
          expect(err).eql("something bad");
        });
    });

    it("should return an error if the verifier is not responding", function() {
      sandbox.stub(fxa.request, "post", function(opts, callback) {
        callback("error", null, null);
      });
      fxa.verifyAssertion("assertion", [audience], ["trusted-issuer"],
        function(err) {
          expect(err).eql("error");
        });
    });

    it("should not accept untrusted issuers", function() {
      assertion.issuer = "untrusted-issuer";
      sandbox.stub(fxa.request, "post", function(opts, callback) {
        callback(null, null, assertion);
      });

      fxa.verifyAssertion("assertion", [audience], ["trusted-issuer"],
        function(err) {
          expect(err).eql("Issuer is not trusted");
        });
    });

    it("should accept trusted issuers", function() {
      assertion.issuer = "trusted-issuer";
      sandbox.stub(fxa.request, "post", function(opts, callback) {
        callback(null, null, assertion);
      });

      fxa.verifyAssertion("assertion", [audience], ["trusted-issuer"],
        function(err, data) {
          expect(err).eql(null);
          expect(data).eql(assertion);
        });
    });

    it("should change the audience given to the verifier if it is valid",
      function(done) {
        // Set the audience we return to app://
        audience = "app://loop.firefox.com";

        sandbox.stub(fxa.request, "post", function(opts, callback) {
          // Should ask the verifier with the app:// scheme.
          expect(opts.json.audience).eql('app://loop.firefox.com');
          callback(null, null, assertion);
        });

        // Start the verification.
        var validAudiences = ['http://loop.firefox.com',
                              'app://loop.firefox.com'];

        fxa.verifyAssertion(assertion, validAudiences, [assertion.issuer],
          done);
      });

    it("should reject an invalid audience", function(done) {
      audience = "invalid";

      var validAudiences = ['http://loop.firefox.com',
                            'app://loop.firefox.com'];

      fxa.verifyAssertion(assertion, validAudiences, [assertion.issuer],
        function(err) {
          expect(err).to.eql("Invalid audience");
          done();
        });
    });

  });
});
