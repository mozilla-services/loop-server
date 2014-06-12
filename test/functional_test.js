/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var expect = require("chai").expect;
var addHawk = require("superagent-hawk");
var supertest = addHawk(require("supertest"));
var sinon = require("sinon");
var crypto = require("crypto");
var assert = sinon.assert;

var app = require("../loop").app;
var request = require('../loop').request;
var validateToken = require("../loop").validateToken;
var validateSimplePushURL = require("../loop").validateSimplePushURL;
var conf = require("../loop").conf;
var hmac = require("../loop").hmac;
var tokBox = require("../loop").tokBox;
var storage = require("../loop").storage;
var statsdClient = require("../loop").statsdClient;
var requireHawkSession = require("../loop").requireHawkSession;
var authenticate = require("../loop").authenticate;

var Token = require("../loop/token").Token;
var tokenlib = require("../loop/tokenlib");
var fxaAuth = require("../loop/fxa");
var tokBoxConfig = conf.get("tokBox");

var getMiddlewares = require("./support").getMiddlewares;
var intersection = require("./support").intersection;
var expectFormatedError = require("./support").expectFormatedError;

var ONE_MINUTE = 60 * 60 * 1000;
var fakeNow = 1393595554796;
var user = "alexis@notmyidea.org";
var userHmac;
var uuid = "1234";
var callerId = 'natim@mozilla.com';

function register(url, assertion, credentials, cb) {
  supertest(app)
    .post('/registration')
    .hawk(credentials)
    .type('json')
    .send({'simple_push_url': url})
    .expect(200)
    .end(function(err, resp) {
      if (err) throw err;
      cb(resp);
    });
}

describe("HTTP API exposed by the server", function() {

  var sandbox, expectedAssertion, pushURL, hawkCredentials, fakeCallInfo,
      genuineOrigins;

  var routes = {
    '/': ['get'],
    '/registration': ['post'],
    '/call-url': ['post', 'del'],
    '/calls': ['get'],
    '/calls/token': ['get', 'post'],
    '/calls/id/callId': ['get', 'del']
  };

  beforeEach(function(done) {
    sandbox = sinon.sandbox.create();
    expectedAssertion = "BID-ASSERTION";
    fakeCallInfo = conf.get("fakeCallInfo");

    genuineOrigins = conf.get('allowedOrigins');
    conf.set('allowedOrigins', ['http://mozilla.org',
                                'http://mozilla.com']);

    // Mock the calls to the external BrowserID verifier.
    sandbox.stub(fxaAuth, "verifyAssertion",
      function(assertion, audience, trustedIssuers, cb){
        if (assertion === expectedAssertion) {
          cb(null, {idpClaims: {"fxa-verifiedEmail": user}});
        } else {
          cb("error");
        }
      });

    // Let's do the tests with a real URL.
    pushURL = 'https://push.services.mozilla.com/update/MGlYke2SrEmYE8ceyu' +
              'STwxawxuEJnMeHtTCFDckvUo9Gwat44C5Z5vjlQEd1od1hj6o38UB6Ytc5x' +
              'gXwSLAH2VS8qKyZ1eLNTQSX6_AEeH73ohUy2A==';

    // Generate Hawk credentials.
    var token = new Token();
    token.getCredentials(function(tokenId, authKey) {
      hawkCredentials = {
        id: tokenId,
        key: authKey,
        algorithm: "sha256"
      };
      userHmac = hmac(tokenId, conf.get("userMacSecret"));
      storage.setHawkSession(tokenId, authKey, done);
    });
  });

  afterEach(function(done) {
    sandbox.restore();
    conf.set('allowedOrigins', genuineOrigins);
    storage.drop(done);
  });

  // Test CORS is enabled in all routes for OPTIONS.
  Object.keys(routes).forEach(function(route) {
    describe("OPTIONS " + route, function() {
      it("should authorize allowed origins to do CORS", function(done) {
        supertest(app)
          .options(route)
          .set('Origin', 'http://mozilla.org')
          .expect('Access-Control-Allow-Origin', 'http://mozilla.org')
          .expect('Access-Control-Allow-Methods',
                  'GET,HEAD,PUT,PATCH,POST,DELETE')
          .end(done);
      });

      it("should reject unauthorized origins to do CORS", function(done) {
        supertest(app)
          .options(route)
          .set('Origin', 'http://not-authorized')
          .end(function(err, res) {
            if (err) throw err;
            expect(res.headers)
              .not.to.have.property('Access-Control-Allow-Origin');
            done();
          });
      });
    });
  });

  // Test CORS is enabled in all routes for GET, POST and DELETE
  Object.keys(routes).forEach(function(route) {
    routes[route].forEach(function(method) {
      if (route.indexOf('token') !== -1) {
        var tokenManager = new tokenlib.TokenManager({
          macSecret: conf.get('macSecret'),
          encryptionSecret: conf.get('encryptionSecret')
        });

        var token = tokenManager.encode({
          uuid: uuid,
          user: user,
          callerId: callerId
        });

        route = route.replace('token', token);
      }

      describe(method + ' ' + route, function() {
        beforeEach(function() {
          var fakeCallInfo = conf.get("fakeCallInfo");
          sandbox.stub(tokBox, "getSessionTokens", function(cb) {
            cb(null, {
              sessionId: fakeCallInfo.session1,
              callerToken: fakeCallInfo.token1,
              calleeToken: fakeCallInfo.token2
            });
          });
        });

        it("should authorize allowed origins to do CORS", function(done) {
          supertest(app)[method](route)
            .set('Origin', 'http://mozilla.org')
            .expect('Access-Control-Allow-Origin', 'http://mozilla.org')
            .end(done);
        });

        it("should reject unauthorized origins to do CORS", function(done) {
          supertest(app)[method](route)
            .set('Origin', 'http://not-authorized')
            .end(function(err, res) {
              if (err) throw err;
              expect(res.headers)
                .not.to.have.property('Access-Control-Allow-Origin');
              done();
            });
        });
      });
    });
  });

  describe("GET /__hearbeat__", function() {

    it("should return a 503 if storage is down", function(done) {
      sandbox.stub(request, "get", function(url, callback){
        callback(null);
      });
      sandbox.stub(storage, "ping", function(callback) {
        callback(false);
      });

      supertest(app)
        .get('/__heartbeat__')
        .expect(503)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.body).to.eql({
            'storage': false,
            'provider': true
          });
          done();
        });
    });

    it("should return a 503 if provider service is down", function(done) {
      sandbox.stub(request, "get", function(url, callback){
        callback("error");
      });
      supertest(app)
        .get('/__heartbeat__')
        .expect(503)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.body).to.eql({
            'storage': true,
            'provider': false
          });
          done();
        });
    });

    it("should return a 200 if all dependencies are ok", function(done) {
      sandbox.stub(request, "get", function(url, callback){
        callback(null);
      });
      supertest(app)
        .get('/__heartbeat__')
        .expect(200)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.body).to.eql({
            'storage': true,
            'provider': true
          });
          done();
        });
    });
  });

  describe("GET /", function() {
    it("should display project information.", function(done) {
      supertest(app)
        .get('/')
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          if (err) throw err;
          ["name", "description", "version", "homepage", "endpoint",
           "fakeTokBox"].forEach(function(key) {
            expect(res.body).to.have.property(key);
          });
          done();
        });
    });

    it("should not display server version if displayVersion is false.",
      function(done) {
        conf.set("displayVersion", false);

        supertest(app)
          .get('/')
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).not.to.have.property("version");
            done();
          });
      });
  });

  describe("POST /call-url", function() {
    var jsonReq;

    beforeEach(function() {
      jsonReq = supertest(app)
        .post('/call-url')
        .hawk(hawkCredentials)
        .type('json')
        .expect('Content-Type', /json/);
    });

    it("should have the requireHawkSession middleware installed", function() {
      expect(getMiddlewares(app, 'post', '/call-url'))
        .include(requireHawkSession);
    });

    it("should require a callerId parameter", function(done) {
      jsonReq.send({}).expect(400).end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res.body, "body", "callerId");
        done();
      });
    });

    it("should check that the given expiration is a number", function(done) {
      jsonReq
        .send({callerId: callerId, expiresIn: "not a number"})
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.body).eql({
            status: "errors",
            errors: [{location: "body",
                      name: "expiresIn",
                      description: "should be a valid number"}]
          });
          done();
        });
    });

    it("should check the given expiration is not greater than the max",
      function(done) {
        var oldMaxTimeout = conf.get('callUrlMaxTimeout');
        conf.set('callUrlMaxTimeout', 5);
        jsonReq
          .send({callerId: callerId, expiresIn: "10"})
          .expect(400)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).eql({
              status: "errors",
              errors: [{location: "body",
                        name: "expiresIn",
                        description: "should be less than 5"}]
            });
            conf.set('callUrlMaxTimeout', oldMaxTimeout);
            done();
          });
      });

    describe("with a tokenManager", function() {
      var clock, tokenManager;

      beforeEach(function() {
        clock = sinon.useFakeTimers(fakeNow);
        tokenManager = new tokenlib.TokenManager({
          macSecret: conf.get('macSecret'),
          encryptionSecret: conf.get('encryptionSecret')
        });
      });

      afterEach(function() {
        clock.restore();
      });

      it("should accept an expiresIn parameter", function(done) {
        jsonReq
          .expect(200)
          .send({callerId: callerId, expiresIn: 5})
          .end(function(err, res) {
            if (err) throw err;
            var callUrl = res.body && res.body.call_url,
                token;

            token = callUrl.split("/").pop();
            var decoded = tokenManager.decode(token);
            expect(decoded.expires).eql(
              Math.round((fakeNow / ONE_MINUTE) + 5)
            );
            done(err);
          });
      });

      it("should generate a valid call-url", function(done) {
        jsonReq
          .expect(200)
          .send({callerId: callerId})
          .end(function(err, res) {
            if (err) throw err;
            var callUrl = res.body && res.body.call_url, token;

            expect(callUrl).to.not.equal(null);
            var urlStart = conf.get('webAppUrl').replace('{token}', '');
            expect(callUrl).to.contain(urlStart);

            token = callUrl.split("/").pop();
            var decoded = tokenManager.decode(token);
            expect(decoded.expires).eql(
              Math.round((fakeNow / ONE_MINUTE) + tokenManager.timeout)
            );
            expect(decoded.hasOwnProperty('uuid'));
            done(err);
          });
      });

      it("should return the expiration date of the call-url", function(done) {
        jsonReq
          .expect(200)
          .send({callerId: callerId})
          .end(function(err, res) {
            if (err) throw err;
            var expiresAt = res.body && res.body.expiresAt;
            expect(expiresAt).eql(387830);
            done();
          });
      });

      it("should count new url generation using statsd", function(done) {
        sandbox.stub(statsdClient, "count");
        jsonReq
          .expect(200)
          .send({callerId: callerId})
          .end(function(err, res) {
            if (err) throw err;
            assert.calledTwice(statsdClient.count);
            assert.calledWithExactly(statsdClient.count, "loop-call-urls", 1);
            assert.calledWithExactly(
              statsdClient.count,
              "loop-call-urls-" + userHmac,
              1
            );
            done();
          });
      });
    });
  });

  describe("POST /registration", function() {
    var jsonReq;
    var url1 = "http://www.example.org";
    var url2 = "http://www.mozilla.org";


    beforeEach(function() {
      jsonReq = supertest(app)
        .post('/registration')
        .hawk(hawkCredentials)
        .type('json')
        .expect('Content-Type', /json/);
    });

    it("should have the authenticate middleware installed",
      function() {
        expect(getMiddlewares(app, 'post', '/registration'))
          .include(authenticate);
      });

    it("should have the validateSimplePushURL middleware installed",
      function() {
        expect(getMiddlewares(app, 'post', '/registration'))
          .include(validateSimplePushURL);
      });

    it("should validate the simple push url", function(done) {
      jsonReq
        .send({'simple_push_url': 'not-an-url'})
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res.body, "body", "simple_push_url",
                              "simple_push_url should be a valid url");
          done();
        });
    });

    it("should reject non-JSON requests", function(done) {
      supertest(app)
        .post('/registration')
        .set('Accept', 'text/html')
        .hawk(hawkCredentials)
        .expect(406).end(function(err, res) {
          if (err) throw err;
          expect(res.body).eql(["application/json"]);
          done();
        });
    });

    // https://bugzilla.mozilla.org/show_bug.cgi?id=986578
    it("should accept request with custom JSON content-type.", function(done) {
      supertest(app)
        .post('/call-url')
        .send({callerId: callerId})
        .hawk(hawkCredentials)
        .type('application/json; charset=utf-8')
        .expect(200).end(done);
    });

    it("should return a 200 if everything went fine", function(done) {
      jsonReq
        .send({'simple_push_url': pushURL})
        .expect(200).end(done);
    });

    it("should store push url", function(done) {
      jsonReq
        .send({'simple_push_url': pushURL})
        .hawk(hawkCredentials)
        .expect(200).end(function(err, res) {
          if (err) throw err;
          storage.getUserSimplePushURLs(userHmac, function(err, records) {
            if (err) throw err;
            expect(records[0]).eql(pushURL);
            done();
          });
        });
    });

    // XXX Bug 980289
    it.skip("should be able to store multiple push urls for one user",
      function(done) {
        register(url1, expectedAssertion, hawkCredentials, function() {
          register(url2, expectedAssertion, hawkCredentials, function() {
            storage.getUserSimplePushURLs(userHmac, function(err, records) {
              if (err) throw err;
              expect(records.length).eql(2);
              done();
            });
          });
        });
      });

    it("should be able to override an old SimplePush URL.", function(done) {
      register(url1, expectedAssertion, hawkCredentials, function() {
        register(url2, expectedAssertion, hawkCredentials, function() {
          storage.getUserSimplePushURLs(userHmac, function(err, records) {
            if (err) throw err;
            expect(records.length).eql(1);
            done();
          });
        });
      });
    });

    it("should return a 503 if the database isn't available", function(done) {
      sandbox.stub(storage, "addUserSimplePushURL",
        function(userMac, simplepushURL, cb) {
          cb("error");
        });
      jsonReq
        .send({'simple_push_url': pushURL})
        .expect(503).end(done);
    });

    it("should return a 503 if the database isn't available on update",
    function(done) {
      sandbox.stub(storage, "addUserSimplePushURL",
        function(userMac, simplepushURL, cb) {
          cb("error");
        });
      jsonReq
        .send({
          'simple_push_url': pushURL,
        }).expect(503).end(done);
    });

    it("should count new users if the session is created", function(done) {
      sandbox.stub(statsdClient, "count");
      supertest(app)
        .post('/registration')
        .type('json')
        .send({
          'simple_push_url': pushURL,
        }).expect(200).end(function(err, res) {
          if (err) throw err;
          assert.calledOnce(statsdClient.count);
          assert.calledWithExactly(
            statsdClient.count,
            "loop-activated-users",
            1
          );
          done();
        });
    });

    it("shouldn't count a new user if the session already exists",
      function(done) {
        sandbox.stub(statsdClient, "count");
        jsonReq
          .send({
            'simple_push_url': pushURL,
          }).expect(200).end(function(err, res) {
            if (err) throw err;
            assert.notCalled(statsdClient.count);
            done();
          });
      });
  });

  describe("DELETE /registration", function() {
    var jsonReq;
    var url = "http://www.mozilla.org";

    beforeEach(function() {
      jsonReq = supertest(app)
        .del('/registration')
        .hawk(hawkCredentials)
        .type('json');
    });

    it("should have the requireHawkSession middleware installed",
      function() {
        expect(getMiddlewares(app, 'delete', '/registration'))
          .include(requireHawkSession);
      });

    it("should have the validateSimplePushURL middleware installed",
      function() {
        expect(getMiddlewares(app, 'delete', '/registration'))
          .include(validateSimplePushURL);
      });

    it("should remove an existing simple push url for an user", function(done) {
      register(url, expectedAssertion, hawkCredentials, function() {
        jsonReq.send({'simple_push_url': url})
          .expect(204)
          .end(done);
      });
    });
  });

  describe("GET /calls/:token", function() {
    it("should return a 302 to the WebApp page", function(done) {
      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });
      var token = tokenManager.encode({
        uuid: uuid,
        user: user,
        callerId: callerId
      }).token;
      supertest(app)
        .get('/calls/' + token)
        .expect("Location", conf.get("webAppUrl").replace("{token}", token))
        .expect(302).end(done);
    });

    it("should have the validateToken middleware installed.", function() {
      expect(getMiddlewares(app, 'get', '/calls/:token'))
        .include(validateToken);
    });
  });

  describe("DELETE /call-url/:token", function() {
    var token, tokenManager, req, clock;
    beforeEach(function() {
      clock = sinon.useFakeTimers(fakeNow);

      tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret'),
        timeout: 1 // Token expires in 1 hour.
      });
      token = tokenManager.encode({
        uuid: uuid,
        user: hawkCredentials.id
      }).token;
      req = supertest(app)
        .del('/call-url/' + token)
        .hawk(hawkCredentials);
    });

    afterEach(function() {
      clock.restore();
    });

    it("should add the token uuid in the revocation list", function(done) {
      req.expect(204).end(function(err, res) {
        if (err) throw err;
        storage.isURLRevoked(uuid, function(err, record) {
          expect(record).eql(true);
          done(err);
        });
      });
    });

    it("should return a 503 is the database is not available", function(done) {
      sandbox.stub(storage, "isURLRevoked", function(urlId, cb) {
        cb("error");
      });
      req.expect(503).end(done);
    });

    it("should return a 403 if the token doesn't belong to the user",
      function(done){
        var token = tokenManager.encode({
          uuid: "1234",
          user: "h4x0r"
        }).token;
        req = supertest(app)
          .del('/call-url/' + token)
          .hawk(hawkCredentials)
          .expect(403).end(done);
      });

    it("should have the validateToken middleware installed", function() {
      expect(getMiddlewares(app, 'delete', '/call-url/:token'))
        .include(validateToken);
    });
  });

  describe("GET /calls", function() {
    var req, calls;

    beforeEach(function(done) {
      req = supertest(app)
        .get('/calls')
        .hawk(hawkCredentials)
        .expect('Content-Type', /json/);

      calls = [
        {
          callId:       crypto.randomBytes(16).toString("hex"),
          callerId:     callerId,
          userMac:      userHmac,
          sessionId:    fakeCallInfo.session1,
          calleeToken:  fakeCallInfo.token1,
          timestamp:    0
        },
        {
          callId:       crypto.randomBytes(16).toString("hex"),
          callerId:     callerId,
          userMac:      userHmac,
          sessionId:    fakeCallInfo.session2,
          calleeToken:  fakeCallInfo.token2,
          timestamp:    1
        },
        {
          callId:       crypto.randomBytes(16).toString("hex"),
          callerId:     callerId,
          userMac:      userHmac,
          sessionId:    fakeCallInfo.session3,
          calleeToken:  fakeCallInfo.token2,
          timestamp:    2
        }
      ];

      storage.addUserCall(userHmac, calls[0], function() {
        storage.addUserCall(userHmac, calls[1], function() {
          storage.addUserCall(userHmac, calls[2], done);
        });
      });
    });

    it("should list existing calls", function(done) {
      var callsList = calls.map(function(call) {
        return {
          callId: call.callId,
          apiKey: tokBoxConfig.apiKey,
          sessionId: call.sessionId,
          sessionToken: call.calleeToken
        };
      });

      req.query({version: 0}).expect(200).end(function(err, res) {
        if (err) throw err;
        expect(res.body).to.deep.equal({calls: callsList});
        done(err);
      });
    });

    it("should list calls more recent than a given version", function(done) {
      var callsList = [{
        callId: calls[2].callId,
        apiKey: tokBoxConfig.apiKey,
        sessionId: calls[2].sessionId,
        sessionToken: calls[2].calleeToken
      }];

      req.query({version: 2}).expect(200).end(function(err, res) {
        if (err) throw err;
        expect(res.body).to.deep.equal({calls: callsList});
        done(err);
      });
    });

    it("should have the requireHawk middleware installed", function() {
      expect(getMiddlewares(app, 'get', '/calls')).include(requireHawkSession);
    });

    it("should answer a 503 if the database isn't available", function(done) {
      sandbox.stub(storage, "getUserCalls", function(userMac, cb) {
        cb("error");
      });

      req.query({version: 0}).expect(503).end(done);
    });

  });

  describe("with tokens", function() {
    var requests, tokenManager, token, jsonReq, tokBoxSessionId,
        tokBoxCallerToken, tokBoxCalleeToken;

    beforeEach(function () {
      requests = [];
      var fakeCallInfo = conf.get("fakeCallInfo");
      sandbox.useFakeTimers(fakeNow);
      tokBoxSessionId = fakeCallInfo.session1;
      tokBoxCalleeToken = fakeCallInfo.token1;
      tokBoxCallerToken = fakeCallInfo.token2;

      tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });

      token = tokenManager.encode({
        uuid: uuid,
        user: hawkCredentials.id,
        callerId: callerId
      }).token;

      sandbox.stub(request, "put", function(options) {
        requests.push(options);
      });

      jsonReq = supertest(app)
        .post('/calls/' + token)
        .send()
        .expect(200);
    });

    describe("POST /calls/:token", function() {
      var emptyReq;

      beforeEach(function() {
        emptyReq = supertest(app).post('/calls/' + token);
        jsonReq = supertest(app)
          .post('/calls/' + token)
          .expect(200);
      });

      it("should have the token validation middleware installed", function() {
        expect(getMiddlewares(app, 'post', '/calls/:token'))
          .include(validateToken);
      });

      it("should return a 503 if tokbox API errors out", function(done) {
        sandbox.stub(tokBox, "getSessionTokens", function(cb) {
          cb("error");
        });
        jsonReq
          .expect(503)
          .end(done);
      });

      describe("With working tokbox APIs", function() {

        beforeEach(function() {
          sandbox.stub(tokBox, "getSessionTokens", function(cb) {
            cb(null, {
              sessionId: tokBoxSessionId,
              callerToken: tokBoxCallerToken,
              calleeToken: tokBoxCalleeToken
            });
          });
        });

        it("should accept valid call token", function(done) {
          jsonReq.end(done);
        });

        // XXX Bug 985387: Handle a SP Url per device
        it.skip("should trigger all the simple push URLs of the user",
          function(done) {
            var url1 = "http://www.example.org";
            var url2 = "http://www.mozilla.org";

            register(url1, expectedAssertion, hawkCredentials, function() {
              register(url2, expectedAssertion, hawkCredentials, function() {
                jsonReq.end(function(err, res) {
                  if (err) throw err;
                  expect(intersection(requests.map(function(record) {
                    return record.url;
                  }), [url1, url2]).length).eql(2);
                  expect(requests.every(function(record) {
                    return record.form.version === fakeNow;
                  }));
                  done();
                });
              });
            });
          });

        it("should return sessionId, apiKey and caller token info",
          function(done) {
            jsonReq.end(function(err, res) {
              if (err) throw err;

              var body = res.body;
              expect(body).to.have.property('callId');
              delete body.callId;

              expect(res.body).eql({
                sessionId: tokBoxSessionId,
                sessionToken: tokBoxCallerToken,
                apiKey: tokBox.apiKey
              });
              done();
            });
          });

        it("should store sessionId and callee token info in database",
          function(done) {
            jsonReq.end(function(err, res) {
              if (err) throw err;

              storage.getUserCalls(userHmac, function(err, items) {
                if (err) throw err;
                expect(items.length).eql(1);
                expect(items[0].callId).to.have.length(32);
                delete items[0].callId;
                expect(items[0]).eql({
                  callerId: callerId,
                  userMac: userHmac,
                  sessionId: tokBoxSessionId,
                  calleeToken: tokBoxCalleeToken,
                  timestamp: fakeNow
                });
                done();
              });
            });
          });

        it("should return a 503 if callsStore is not available",
          function(done) {
            sandbox.stub(storage, "addUserCall", function(userMac, call, cb) {
              cb("error");
            });
            jsonReq
              .expect(503)
              .end(done);
          });

        it("should return a 503 if urlsStore is not available", function(done) {
          sandbox.stub(storage, "getUserSimplePushURLs", function(userMac, cb) {
            cb("error");
          });
          jsonReq
            .expect(503)
            .end(done);
        });
      });
    });

    describe("GET /calls/id/:callId", function() {
      var baseReq;

      beforeEach(function () {
        sandbox.stub(tokBox, "getSessionTokens", function(cb) {
          cb(null, {
            sessionId: tokBoxSessionId,
            callerToken: tokBoxCallerToken,
            calleeToken: tokBoxCalleeToken
          });
        });

        baseReq = supertest(app)
          .post('/calls/' + token)
          .send({nickname: "foo"})
          .expect(200);
      });

      it("should return a 503 if the database is not available.",
        function(done) {
          sandbox.stub(storage, "getCall", function(callId, cb) {
            cb(new Error("error"));
          });

          var fakeUUID = crypto.randomBytes(16).toString('hex');

          supertest(app)
            .get('/calls/id/' + fakeUUID)
            .expect(503)
            .end(done);
        });

      it("should return a 404 if the call doesn't exists.", function(done) {
        supertest(app)
          .get('/calls/id/invalidUUID')
          .expect(404)
          .end(done);
      });

      it("should return a 200 if the call exists.", function(done) {
        baseReq.end(function(req, res) {
            supertest(app)
              .get('/calls/id/' + res.body.callId)
              .expect(200)
              .end(done);
          });
      });
    });

    describe("DELETE /calls/id/:callId", function() {

      var createCall;

      beforeEach(function () {
        sandbox.stub(tokBox, "getSessionTokens", function(cb) {
          cb(null, {
            sessionId: tokBoxSessionId,
            callerToken: tokBoxCallerToken,
            calleeToken: tokBoxCalleeToken
          });
        });
        createCall = supertest(app)
          .post('/calls/' + token)
          .send({nickname: "foo"})
          .expect(200);
      });

      it("should return a 404 on an already deleted call.", function(done) {
        supertest(app)
          .del('/calls/id/invalidUUID')
          .hawk(hawkCredentials)
          .expect(404)
          .end(done);
      });

      it("should return a 200 ok on an existing call.", function(done) {
        createCall.end(function(err, res) {
          if (err) throw err;
          var callId = res.body.callId;

          supertest(app)
            .del('/calls/id/' + callId)
            .expect(204)
            .end(done);
        });
      });
    });
  });
});
