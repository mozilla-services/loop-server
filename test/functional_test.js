/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var request = require("supertest");
var sinon = require("sinon");

var app = require("../loop").app;
var urlsStore = require("../loop").urlsStore;
var conf = require("../loop").conf;
var tokenlib = require("../loop/tokenlib");
var auth = require("../loop/authentication");

var ONE_MINUTE = 60 * 60 * 1000;
var fakeNow = 1393595554796;

function getMiddlewares(method, url) {
  return app.routes[method].filter(function(e){
    return e.path === url;
  }).shift().callbacks;
}

describe("HTTP API exposed by the server", function() {

  var sandbox, expectedAssertion, pushURL, user;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    expectedAssertion = "BID-ASSERTION";
    user = "alexis@notmyidea.org";

    // Mock the calls to the external BrowserID verifier.
    sandbox.stub(auth, "verify", function(assertion, audience, cb){
      if (assertion === expectedAssertion)
        cb(null, user, {});
      else
        cb("error");
    });

    // Let's do the tests with a real URL.
    pushURL = 'https://push.services.mozilla.com/update/MGlYke2SrEmYE8ceyu' +
              'STwxawxuEJnMeHtTCFDckvUo9Gwat44C5Z5vjlQEd1od1hj6o38UB6Ytc5x' +
              'gXwSLAH2VS8qKyZ1eLNTQSX6_AEeH73ohUy2A==';
  });

  afterEach(function(done) {
    sandbox.restore();
    urlsStore.drop(function() {
      done();
    });
  });

  describe("GET /", function() {
    it("should display project information.", function(done) {
      request(app)
        .get('/')
        .expect(200)
        .end(function(err, res) {
          ["name", "description", "version", "homepage"].forEach(function(key) {
            expect(res.body).to.have.property(key);
          });
          done();
        });
    });

    it("should not display server version if displayVersion is false.",
    function(done) {
      conf.set("displayVersion", false);

      request(app)
        .get('/')
        .expect(200)
        .end(function(err, res) {
          expect(res.body).not.to.have.property("version");
          done();
        });
    });

  });

  describe("authentication middleware", function() {
    var jsonReq;

    // Create a route with the auth middleware installed.
    app.post('/with-middleware', auth.isAuthenticated, function(req, res) {
      res.json(200, req.user);
    });

    beforeEach(function() {
      jsonReq = request(app)
        .post('/with-middleware');
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

  describe("POST /call-url", function() {
    var jsonReq;

    beforeEach(function() {
      jsonReq = request(app)
        .post('/call-url')
        .send({})
        .set('Authorization', 'BrowserID ' + expectedAssertion)
        .type('json')
        .expect('Content-Type', /json/);
    });

    it("should have the authentication middleware installed", function() {
      expect(getMiddlewares('post', '/call-url')).include(auth.isAuthenticated);
    });

    it("should generate a valid call-url", function(done) {
      var clock = sinon.useFakeTimers(fakeNow);
      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });

      jsonReq
        .expect(200)
        .end(function(err, res) {
          var callUrl = res.body && res.body.call_url, token;

          expect(callUrl).to.not.equal(null);
          expect(callUrl).to.match(/^http:\/\/127.0.0.1/);

          // XXX: the content of the token should change in the
          // future.
          token = callUrl.split("/").pop();
          expect(tokenManager.decode(token)).to.deep.equal({
            expires: Math.round((fakeNow / ONE_MINUTE) + tokenManager.timeout)
          });

          clock.restore();
          done(err);
        });
    });
  });

  describe("POST /registration", function() {
    var jsonReq;

    beforeEach(function() {
      jsonReq = request(app)
        .post('/registration')
        .set('Authorization', 'BrowserID ' + expectedAssertion)
        .type('json')
        .expect('Content-Type', /json/);
    });

    it("should have the authentication middleware installed", function() {
      expect(getMiddlewares('post', '/registration'))
        .include(auth.isAuthenticated);
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
        .post('/registration')
        .set('Authorization', 'BrowserID ' + expectedAssertion)
        .type('html')
        .expect(406).end(function(err, res) {
          if (err) throw err;
          expect(res.body).eql(["application/json"]);
          done();
        });
    });

    it("should return a 200 if everything went fine", function(done) {
      jsonReq
        .send({'simple_push_url': pushURL})
        .expect(200).end(done);
    });

    it("should store push url", function(done) {
      jsonReq
        .send({'simple_push_url': pushURL})
        .expect(200).end(function(err, res) {
          if (err) {
            throw err;
          }

          urlsStore.findOne({user: user}, function(err, record) {
            if (err) {
              throw err;
            }

            expect(record.simplepushURL).eql(pushURL);
            done();
          });
        });
    });

    it("should be able to store multiple push urls for one user",
      function(done) {
        function addPushURL(url, callback) {
          request(app)
            .post('/registration')
            .set('Authorization', 'BrowserID ' + expectedAssertion)
            .type('json')
            .send({'simple_push_url': pushURL})
            .expect('Content-Type', /json/)
            .expect(200).end(callback);
        }

        addPushURL("http://url1", function(err, res) {
          if (err) {
            throw err;
          }
          addPushURL("http://url2", function(err, res) {
            urlsStore.find({user: user}, function(err, records) {
              if (err) {
                throw err;
              }
              expect(records.length).eql(2);
              done();
            });
          });
        });
      });

    it("should answer a 503 if the database isn't available", function(done) {
      sandbox.stub(urlsStore, "add", function(record, cb) {
        cb("error");
      });
      jsonReq
      .send({'simple_push_url': pushURL})
      .expect(503).end(done);
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
