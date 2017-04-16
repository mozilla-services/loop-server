/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var expect = require("chai").expect;
var addHawk = require("superagent-hawk");
var supertest = addHawk(require("supertest"));
var sinon = require("sinon");
var randomBytes = require("crypto").randomBytes;
var assert = sinon.assert;

var constants = require("../loop/constants");
var encrypt = require("../loop/encrypt").encrypt;
var loop = require("../loop");
var apiRouter = loop.apiRouter;
var app = loop.app;
var request = require("request");

var conf = loop.conf;
var tokBox = loop.tokBox;
var storage = loop.storage;
var statsdClient = loop.statsdClient;

var utils = require("../loop/utils");
var getProgressURL = utils.getProgressURL;
var time = utils.time;

var Token = require("express-hawkauth").Token;
var tokenlib = require("../loop/tokenlib");
var fxaAuth = require("../loop/fxa");
var tokBoxConfig = conf.get("tokBox");
var hmac = require("../loop/hmac");
var pjson = require("../package.json");

var analytics = require("../loop/routes/analytics");
var getMiddlewares = require("./support").getMiddlewares;
var expectFormattedError = require("./support").expectFormattedError;
var errors = require("../loop/errno.json");
var hekaLogger = require("../loop/middlewares").hekaLogger;

var auth = loop.auth;
var authenticate = auth.authenticate;
var requireHawkSession = auth.requireHawkSession;
var requireRegisteredUser = auth.requireRegisteredUser;

var validators = loop.validators;
var validateToken = validators.validateToken;
var validateCallType = validators.validateCallType;
var validateCallParams = validators.validateCallParams;

var fakeNow = 1393595554796;
var user = "alexis@notmyidea.org";
var user2 = "alexis@mozilla.com";
var user3 = "+33675002145";
var callerId = 'natim@mozilla.com';
var callToken = 'call-token';
var urlCreationDate = 1404139145;
var progressURL = getProgressURL(conf.get('publicServerAddress'));
var callUrls = conf.get('callUrls');

function runOnPrefix(apiPrefix) {
  var userHmac, userHmac2, userHmac3, hawkIdHmac, hawkIdHmac2, hawkIdHmac3;

  function register(url, assertion, credentials, callback) {
    supertest(app)
      .post(apiPrefix + '/registration')
      .hawk(credentials)
      .type('json')
      .send({'simple_push_url': url})
      .expect(200)
      .end(function(err, resp) {
        if (err) throw err;
        callback(resp);
      });
  }

  function startsWith(string, prefix) {
    return string.lastIndexOf(prefix, 0) === 0;
  }

  describe("on " + (apiPrefix || "/"), function() {

    var sandbox, expectedAssertion, pushURL, pushURL2, pushURL3,
        hawkCredentials, hawkCredentials2, fakeCallInfo, genuineOrigins;

    var routes = {
      '/': ['get'],
      '/registration': ['post'],
      '/call-url': ['post', 'del'],
      '/calls': ['get', 'post'],
      '/calls/token': ['get', 'post'],
      '/calls/id/callId': ['get', 'del'],
      '/rooms': ['post', 'get'],
      '/rooms/token': ['patch', 'del', 'get', 'post']
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
        function(assertion, audience, trustedIssuers, callback){
          if (assertion === expectedAssertion) {
            callback(null, {idpClaims: {"fxa-verifiedEmail": user}});
          } else {
            callback(new Error("error"));
          }
        });

      // Let's do the tests with a real URL.
      pushURL = 'https://push.services.mozilla.com/update/MGlYke2SrEmYE8ceyu' +
                'STwxawxuEJnMeHtTCFDckvUo9Gwat44C5Z5vjlQEd1od1hj6o38UB6Ytc5x' +
                'gXwSLAH2VS8qKyZ1eLNTQSX6_AEeH73ohUy2A==';

      pushURL2 = 'https://push2.services.mozilla.com/update/MGlYke2SrEmYE8ceyu' +
                 'STwxawxuEJnMeHtTCFDckvUo9Gwat44C5Z5vjlQEd1od1hj6o38UB6Ytc5x' +
                 'gXwSLAH2VS8qKyZ1eLNTQSX6_AEeH73ohUy2A==';

      pushURL3 = 'https://push3.services.mozilla.com/update/MGlYke2SrEmYE8ceyu' +
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
        hawkIdHmac = hmac(tokenId, conf.get('hawkIdSecret'));
        userHmac = hmac(user, conf.get('userMacSecret'));
        storage.setHawkSession(hawkIdHmac, authKey, function(err) {
          if (err) throw err;
          storage.setHawkUser(userHmac, hawkIdHmac, function(err) {
            if (err) throw err;
            storage.setHawkUserId(hawkIdHmac, encrypt(tokenId, user), function(err) {
              if (err) throw err;
              // Generate Hawk credentials.
              var token2 = new Token();
              token2.getCredentials(function(tokenId2, authKey2) {
                hawkCredentials2 = {
                  id: tokenId2,
                  key: authKey2,
                  algorithm: "sha256"
                };
                hawkIdHmac2 = hmac(tokenId2, conf.get('hawkIdSecret'));
                userHmac2 = hmac(user2, conf.get('userMacSecret'));
                storage.setHawkSession(hawkIdHmac2, authKey2, function(err) {
                  if (err) throw err;
                  storage.setHawkUser(userHmac2, hawkIdHmac2, function(err) {
                    if (err) throw err;
                    // Generate Hawk credentials.
                    var token3 = new Token();
                    token3.getCredentials(function(tokenId3, authKey3) {
                      hawkIdHmac3 = hmac(tokenId3, conf.get('hawkIdSecret'));
                      userHmac3 = hmac(user3, conf.get('userMacSecret'));
                      storage.setHawkSession(hawkIdHmac3, authKey3, function(err) {
                        if (err) throw err;
                        storage.setHawkUser(userHmac3, hawkIdHmac3, done);
                      });
                    });
                  });
                });
              });
            });
          });
        });
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
            .options(apiPrefix + route)
            .set('Origin', 'http://mozilla.org')
            .expect('Access-Control-Allow-Origin', 'http://mozilla.org')
            .expect('Access-Control-Allow-Methods',
                    'GET,HEAD,PUT,PATCH,POST,DELETE')
            .end(done);
        });

        it("should reject unauthorized origins to do CORS", function(done) {
          supertest(app)
            .options(apiPrefix + route)
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

    Object.keys(routes).forEach(function(route) {
      routes[route].forEach(function(method) {
        if (route.indexOf('token') !== -1) {
          var token = tokenlib.generateToken(callUrls.tokenSize);
          route = route.replace('token', token);
        }

        describe(method + ' ' + route, function() {
          beforeEach(function() {
            var fakeCallInfo = conf.get("fakeCallInfo");
            sandbox.stub(tokBox, "getSessionTokens", function(opts, callback) {
              callback(null, {
                apiKey: tokBoxConfig.credentials.default.apiKey,
                sessionId: fakeCallInfo.session1,
                callerToken: fakeCallInfo.token1,
                calleeToken: fakeCallInfo.token2
              });
            });
          });

          it("should authorize allowed origins to do CORS", function(done) {
            supertest(app)[method](apiPrefix + route)
              .set('Origin', 'http://mozilla.org')
              .expect('Access-Control-Allow-Origin', 'http://mozilla.org')
              .end(done);
          });

          it("should reject unauthorized origins to do CORS", function(done) {
            supertest(app)[method](apiPrefix + route)
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


    describe("GET /__lbheartbeat__", function() {
      it("should return a 200 if everything is ok", function(done) {
        supertest(app)
          .get(apiPrefix + '/__lbheartbeat__')
          .expect(200)
          .end(function(err) {
            if (err) throw err;
            done();
          });
      });
    });

    describe("GET /__heartbeat__", function() {
      var defaultPushURI = "https://push.services.mozilla.com/";
      beforeEach(function() {
        conf.set("pushServerURIs", ["wss://push.services.mozilla.com/"]);
      });

      it("should return a 503 if storage is down", function(done) {
        var fxaStatusUrl;
        // TokBox
        sandbox.stub(request, "post", function(options, callback) {
          callback(null, {statusCode: 200});
        });
        // FxA Verifier and SimplePush
        sandbox.stub(request, "get", function(options, callback) {
          if (!startsWith(options.url, defaultPushURI)) {
            fxaStatusUrl = options.url;
          }
          callback(null, {statusCode: 200});
        });
        sandbox.stub(storage, "ping", function(callback) {
          callback(new Error("read only"));
        });

        supertest(app)
          .get(apiPrefix + '/__heartbeat__')
          .expect(503)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).to.eql({
              'storage': false,
              'provider': true,
              'push': true,
              'fxaVerifier': true
            });
            var expected = 'https://verifier.accounts.firefox.com/status';
            expect(fxaStatusUrl).to.eql(expected);
            done();
          });
      });

      it("should return a 503 if provider service is down", function(done) {
        // TokBox
        sandbox.stub(request, "post", function(options, callback) {
          callback(new Error("blah"));
        });
        // FxA Verifier and SimplePush
        sandbox.stub(request, "get", function(options, callback) {
          callback(null, {statusCode: 200});
        });
        supertest(app)
          .get(apiPrefix + '/__heartbeat__')
          .expect(503)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).to.eql({
              'storage': true,
              'provider': false,
              'push': true,
              'message': "TokBox Error: The request failed: Error: blah",
              'fxaVerifier': true
            });
            done();
          });
      });

      it("should return a 200 if all dependencies are ok", function(done) {
        // TokBox
        sandbox.stub(request, "post", function(options, callback) {
          callback(null, {statusCode: 200});
        });
        // FxA Verifier and SimplePush
        sandbox.stub(request, "get", function(options, callback) {
          callback(null, {statusCode: 200});
        });
        supertest(app)
          .get(apiPrefix + '/__heartbeat__')
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).to.eql({
              'storage': true,
              'provider': true,
              'push': true,
              'fxaVerifier': true
            });
            done();
          });
      });

      it("should return a 503 if it's not able to reach a SP url", function(done) {
        conf.set("pushServerURIs", [
          "wss://push1.services.mozilla.com",
          "http://push2.services.mozilla.com",
          "ws://push3.services.mozilla.com"
        ]);
        sandbox.stub(tokBox, "ping", function(options, callback) {
          callback(null);
        });

        // TokBox
        sandbox.stub(request, "post", function(options, callback) {
          callback(null, {statusCode: 200});
        });
        // FxA Verifier and SimplePush
        sandbox.stub(request, "get", function(options, callback) {
          if (startsWith(options.url, "http://push3.services.mozilla.com")) {
            callback(new Error("error"));
          } else {
            callback(null, {statusCode: 200});
          }
        });

        supertest(app)
          .get(apiPrefix + '/__heartbeat__')
          .expect(503)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).to.eql({
              'storage': true,
              'provider': true,
              'push': false,
              'fxaVerifier': true
            });
            done();
          });
      });

      it("should count SimplePush call if it's not able to reach the SP url", function(done) {
        sandbox.stub(tokBox, "ping", function(options, callback) {
          callback(null);
        });

        // TokBox
        sandbox.stub(request, "post", function(options, callback) {
          callback(null, {statusCode: 200});
        });
        // FxA Verifier and SimplePush
        sandbox.stub(request, "get", function(options, callback) {
          if (startsWith(options.url, defaultPushURI)) {
            callback(new Error("error"));
          } else {
            callback(null, {statusCode: 200});
          }
        });

        sandbox.stub(statsdClient, "increment");

        supertest(app)
          .get(apiPrefix + '/__heartbeat__')
          .expect(503)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).to.eql({
              'storage': true,
              'provider': true,
              'push': false,
              'fxaVerifier': true
            });
            assert.calledOnce(statsdClient.increment);
            assert.calledWithExactly(statsdClient.increment, "loop.simplepush.call.heartbeat", 1, ['failure']);
            done();
          });
      });

      it("should return a 200 if it's able to reach all backends (with SP specified)",
        function(done) {
          conf.set("pushServerURIs", [
            "wss://push1.services.mozilla.com",
            "http://push2.services.mozilla.com",
            "ws://push3.services.mozilla.com"
          ]);
          sandbox.stub(tokBox, "ping", function(options, callback) {
            callback(null);
          });

          // TokBox
          sandbox.stub(request, "post", function(options, callback) {
            callback(null, {statusCode: 200});
          });
          // FxA Verifier and SimplePush
          sandbox.stub(request, "get", function(options, callback) {
            callback(null, {statusCode: 200});
          });

          supertest(app)
            .get(apiPrefix + '/__heartbeat__')
            .expect(200)
            .end(function(err, res) {
              if (err) throw err;
              expect(res.body).to.eql({
                'storage': true,
                'provider': true,
                'push': true,
                'fxaVerifier': true
              });
              done();
            });
      });

      it("should count SP call if it's able to reach all backends (with SP specified)",
        function(done) {
          sandbox.stub(tokBox, "ping", function(options, callback) {
            callback(null);
          });

          // TokBox
          sandbox.stub(request, "post", function(options, callback) {
            callback(null, {statusCode: 200});
          });
          // FxA Verifier and SimplePush
          sandbox.stub(request, "get", function(options, callback) {
            callback(null, {statusCode: 200});
          });

          sandbox.stub(statsdClient, "increment");

          supertest(app)
            .get(apiPrefix + '/__heartbeat__')
            .expect(200)
            .end(function(err, res) {
              if (err) throw err;
              expect(res.body).to.eql({
                'storage': true,
                'provider': true,
                'push': true,
                'fxaVerifier': true
              });
              assert.calledOnce(statsdClient.increment);
              assert.calledWithExactly(statsdClient.increment, "loop.simplepush.call.heartbeat", 1, ['success']);
              done();
            });
      });

      it("should return a 503 if the FxA verifier is down.", function(done) {
        // TokBox
        sandbox.stub(request, "post", function(options, callback) {
          callback(null, {statusCode: 200});
        });
        // FxA Verifier and SimplePush
        sandbox.stub(request, "get", function(options, callback) {
          if (startsWith(options.url, defaultPushURI)) {
            callback(null, {statusCode: 200});
          } else {
            callback(null, {statusCode: 503});
          }
        });
        supertest(app)
          .get(apiPrefix + '/__heartbeat__')
          .expect(503)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).to.eql({
              'storage': true,
              'push': true,
              'provider': true,
              'fxaVerifier': false
            });
            done();
          });
      });
    });

    describe("GET /", function() {
      it("should display project information.", function(done) {
        supertest(app)
          .get(apiPrefix + '/')
          .expect(200)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) throw err;
            ["name", "description", "version", "homepage", "endpoint",
             "fakeTokBox", "fxaOAuth", "branch", "rev"].forEach(function(key) {
              expect(res.body).to.have.property(key);
            });
            done();
          });
      });

      it("should not display server version if displayVersion is false.",
        function(done) {
          conf.set("displayVersion", false);

          supertest(app)
            .get(apiPrefix + '/')
            .expect(200)
            .end(function(err, res) {
              conf.set("displayVersion", true);
              if (err) throw err;
              expect(res.body).not.to.have.property("version");
              done();
            });
        });
    });

    describe("GET /push-server-config", function() {
      it("should return the push server configuration", function(done) {
        supertest(app)
          .get(apiPrefix + '/push-server-config')
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).eql({
              pushServerURI: 'wss://push.services.mozilla.com/'
            });
            done();
          });
      });
    });

    describe("GET /call-url", function() {
      var jsonReq;

      beforeEach(function() {
        jsonReq = supertest(app)
          .get(apiPrefix + '/call-url')
          .hawk(hawkCredentials)
          .type('json')
          .expect('Content-Type', /json/);
      });

      it("should have the requireHawkSession middleware installed", function() {
        expect(getMiddlewares(apiRouter, 'post', '/call-url'))
          .include(requireHawkSession);
      });

      it("should return an empty list if no call-url", function(done) {
        jsonReq.send({}).expect(200).end(function(err, res) {
          if (err) throw err;
          expect(res.body).to.eql([]);
          done();
        });
      });

      it("should return a list of call-url with some information",
        function(done) {
          storage.addUserCallUrlData(userHmac,
            tokenlib.generateToken(conf.get('callUrls').tokenSize), {
              userMac: userHmac,
              callerId: callerId,
              timestamp: time(),
              issuer: "alexis",
              subject: undefined,
              expires: time() + (10 * tokenlib.ONE_HOUR)
            },
            function(err) {
              if (err) throw err;

              jsonReq.send({}).expect(200).end(function(err, res) {
                if (err) throw err;
                expect(res.body).to.length(1);
                var callUrlData = res.body[0];
                expect(callUrlData).to.have.property("expires");
                expect(callUrlData).to.have.property("timestamp");
                delete callUrlData.expires;
                delete callUrlData.timestamp;
                expect(callUrlData).to.eql({
                  "callerId": "natim@mozilla.com",
                  "issuer": "alexis"
                });
                done();
              });
            });
        });

      it("should return a list of call-url with some information & subject",
        function(done) {
          storage.addUserCallUrlData(userHmac,
            tokenlib.generateToken(conf.get('callUrls').tokenSize), {
              userMac: userHmac,
              callerId: callerId,
              timestamp: time(),
              issuer: "alexis",
              subject: "dummySubject",
              expires: time() + (10 * tokenlib.ONE_HOUR)
            },
            function(err) {
              if (err) throw err;

              jsonReq.send({}).expect(200).end(function(err, res) {
                if (err) throw err;
                expect(res.body).to.length(1);
                var callUrlData = res.body[0];
                expect(callUrlData).to.have.property("expires");
                expect(callUrlData).to.have.property("timestamp");
                delete callUrlData.expires;
                delete callUrlData.timestamp;
                expect(callUrlData).to.eql({
                  "callerId": "natim@mozilla.com",
                  "issuer": "alexis",
                  "subject": "dummySubject"
                });
                done();
              });
            });
        });
    });

    describe("POST /call-url", function() {
      var jsonReq;

      beforeEach(function() {
        jsonReq = supertest(app)
          .post(apiPrefix + '/call-url')
          .hawk(hawkCredentials)
          .type('json')
          .expect('Content-Type', /json/);
      });

      it("should have the requireHawkSession middleware installed", function() {
        expect(getMiddlewares(apiRouter, 'post', '/call-url'))
          .include(requireHawkSession);
      });

      it("should return a 405", function(done) {
        jsonReq.send({}).expect(405).end(function(err, res) {
          if (err) throw err;
          expectFormattedError(res, 405, errors.NO_LONGER_SUPPORTED,
                               "No longer supported");
          done();
        });
      });
    });

    describe("POST /registration", function() {
      var jsonReq;
      var url1 = "http://www.example.org";
      var url2 = "http://www.mozilla.org";


      beforeEach(function() {
        jsonReq = supertest(app)
          .post(apiPrefix + '/registration')
          .hawk(hawkCredentials)
          .type('json')
          .expect('Content-Type', /json/);
      });

      it("should have the authenticate middleware installed",
        function() {
          expect(getMiddlewares(apiRouter, 'post', '/registration'))
            .include(authenticate);
        });

      it("should validate the simple push url", function(done) {
        jsonReq
          .send({'simple_push_url': 'not-an-url'})
          .expect(400)
          .end(function(err, res) {
            if (err) throw err;
            expectFormattedError(res, 400, errors.INVALID_PARAMETERS,
                                "simplePushURLs.calls should be a valid url");
            done();
          });
      });

      it("should work with no data passed", function(done) {
        jsonReq
          .send({})
          .expect(200)
          .end(function(err) {
            if (err) throw err;
            done();
          });
      });

      it("should reject non-JSON requests when a SimplePush URL is provided", function(done) {
        supertest(app)
          .post(apiPrefix + '/registration')
          .send({simple_push_url: 'yeah'})
          .set('Accept', 'text/html')
          .hawk(hawkCredentials)
          .expect(406).end(function(err, res) {
            if (err) throw err;
            expectFormattedError(res, 406, errors.BADJSON,
              "Request body should be defined as application/json");
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
          .hawk(hawkCredentials)
          .expect(200).end(function(err) {
            if (err) throw err;
            storage.getUserSimplePushURLs(userHmac, function(err, records) {
              if (err) throw err;
              expect(records.calls).eql([pushURL]);
              done();
            });
          });
      });

      it("should be able to store multiple push urls for one user",
        function(done) {
          storage.setHawkUser(userHmac, hawkIdHmac2, function(err) {
            if (err) throw err;
            register(url1, expectedAssertion, hawkCredentials, function() {
              register(url2, expectedAssertion, hawkCredentials2, function() {
                storage.getUserSimplePushURLs(userHmac, function(err, records) {
                  if (err) throw err;
                  expect(records.calls.length).eql(2);
                  done();
                });
              });
            });
          });
        });

      it("should return a 503 if the database isn't available on update", function(done) {
        sandbox.stub(storage, "addUserSimplePushURLs",
          function(userMac, hawkHmacId, simplepushURL, callback) {
            callback("error");
          });
        jsonReq
          .send({'simplePushURL': pushURL})
          .expect(503).end(done);
      });

      it("should count new users if the session is created", function(done) {
        sandbox.stub(statsdClient, "increment");
        supertest(app)
          .post(apiPrefix + '/registration')
          .type('json')
          .send({
            'simplePushURL': pushURL
          }).expect(200).end(function(err) {
            if (err) throw err;
            assert.calledOnce(statsdClient.increment);
            assert.calledWithExactly(
              statsdClient.increment,
              "loop.activated-users");
            done();
          });
      });

      it("shouldn't count a new user if the session already exists",
        function(done) {
          sandbox.stub(statsdClient, "increment");
          jsonReq
            .send({
              'simple_push_url': pushURL
            }).expect(200).end(function(err) {
              if (err) throw err;
              assert.notCalled(statsdClient.increment);
              done();
            });
        });

      it("should create a session token even if the SP url is not provided",
        function(done) {
          jsonReq.send({}).expect(200).end(function(err, res) {
            if (err) throw err;
            expect(res.headers['server-authorization']).not.eql(undefined);
            done();
          });
        });
    });

    describe("DELETE /registration", function() {
      var jsonReq;
      var url = "http://www.mozilla.org";

      beforeEach(function() {
        jsonReq = supertest(app)
          .del(apiPrefix + '/registration')
          .hawk(hawkCredentials)
          .type('json');
      });

      it("should have the requireHawkSession middleware installed",
        function() {
          expect(getMiddlewares(apiRouter, 'delete', '/registration'))
            .include(requireHawkSession);
        });

      it("should remove an existing simple push url for an user", function(done) {
        register(url, expectedAssertion, hawkCredentials, function() {
          storage.getUserSimplePushURLs(userHmac, function(err, spurls) {
            if (err) throw err;
            expect(spurls).to.eql({rooms: [], calls: ["http://www.mozilla.org"]});
            jsonReq.send({})
              .expect(204)
              .end(function(err) {
                if (err) throw err;
                storage.getUserSimplePushURLs(userHmac, function(err, spurls) {
                  if (err) throw err;
                  expect(spurls).to.eql({rooms: [], calls: []});
                  storage.getHawkSession(hawkIdHmac, function(err, result) {
                    if (err) throw err;
                    expect(result).to.eql(null);
                    done();
                  });
                });
              });
            });
        });
      });
    });

    describe("GET /calls/:token", function() {
      it("should have the validateToken middleware installed.", function() {
        expect(getMiddlewares(apiRouter, 'get', '/calls/:token'))
          .include(validateToken);
      });

      it("should return a the calleeFriendlyName", function(done) {
        var calleeFriendlyName = "Adam Roach";
        var token = tokenlib.generateToken(callUrls.tokenSize);
        var timestamp = parseInt(Date.now() / 1000, 10);
        storage.addUserCallUrlData(userHmac, token, {
          userMac: userHmac,
          issuer: calleeFriendlyName,
          timestamp: timestamp,
          expires: parseInt(Date.now() / 1000, 10) + callUrls.timeout
        }, function(err) {
          if (err) throw err;

          supertest(app)
            .get(apiPrefix + '/calls/' + token)
            .hawk(hawkCredentials)
            .expect(200)
            .expect('Content-Type', /json/)
            .end(function(err, res) {
              if (err) throw err;
              expect(res.body).to.deep.equal({
                calleeFriendlyName: calleeFriendlyName,
                urlCreationDate: timestamp
              });
              done();
            });
        });
      });
    });

    describe("PUT /call-url/:token", function() {
      var token;
      beforeEach(function(done) {
        token = tokenlib.generateToken(callUrls.tokenSize);
        storage.addUserCallUrlData(userHmac, token, {
          timestamp: parseInt(Date.now() / 1000, 10),
          expires: parseInt(Date.now() / 1000, 10) + callUrls.timeout
        }, function(err) {
          if (err) throw err;
          done();
        });
      });

      it("should ignore invalid fields", function(done) {
        supertest(app)
          .put(apiPrefix + '/call-url/' + token)
          .hawk(hawkCredentials)
          .send({
            callerId: "Adam",
            invalidField: "value"
          })
          .expect(200)
          .end(function(err) {
            if (err) throw err;
            storage.getCallUrlData(token, function(err, res) {
              if (err) throw err;
              expect(res.callerId).to.eql("Adam");
              expect(res.invalidField).to.eql(undefined);
              done();
            });
          });
      });

      it("should accept valid fields", function(done) {
        supertest(app)
          .put(apiPrefix + '/call-url/' + token)
          .hawk(hawkCredentials)
          .send({
            callerId: "Adam",
            expiresIn: 250,
            issuer: "Mark Banner"
          })
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body.expiresAt).not.eql(undefined);
            done();
          });

      });

      it("should accept optional subject field", function(done) {
        supertest(app)
          .put(apiPrefix + '/call-url/' + token)
          .hawk(hawkCredentials)
          .send({
            callerId: "Adam",
            expiresIn: 250,
            issuer: "Mark Banner",
            subject: "DummySubject"
          })
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body.expiresAt).not.eql(undefined);
            done();
          });

      });

    });

    describe("DELETE /call-url/:token", function() {
      var token, req, clock;

      beforeEach(function(done) {
        clock = sinon.useFakeTimers(fakeNow);

        token = tokenlib.generateToken(callUrls.tokenSize);
        storage.addUserCallUrlData(userHmac, token, {
          userMac: userHmac,
          timestamp: parseInt(Date.now() / 1000, 10),
          expires: parseInt(Date.now() / 1000, 10) + callUrls.timeout
        }, function(err) {
          if (err) throw err;
          req = supertest(app)
            .del(apiPrefix + '/call-url/' + token)
            .hawk(hawkCredentials);
          done();
        });
      });

      afterEach(function() {
        clock.restore();
      });

      it("should remove the call-url", function(done) {
        req.expect(204).end(function(err) {
          if (err) throw err;
          storage.getCallUrlData(token, function(err, record) {
            if (err) throw err;
            expect(record).eql(null);
            done();
          });
        });
      });

      it("should return a 503 is the database is not available", function(done) {
        sandbox.stub(storage, "getCallUrlData", function(urlId, callback) {
          callback("error");
        });
        req.expect(503).end(done);
      });

      it("should return a 403 if the token doesn't belong to the user",
        function(done){
          var userMac = "h4x0r";

          storage.addUserCallUrlData(userMac, token, {
            userMac: userMac,
            timestamp: parseInt(Date.now() / 1000, 10),
            expires: parseInt(Date.now() / 1000, 10) + callUrls.timeout
          }, function(err) {
            if (err) throw err;
            req = supertest(app)
              .del(apiPrefix + '/call-url/' + token)
              .hawk(hawkCredentials)
              .expect(403).end(done);
          });
        });

      it("should have the validateToken middleware installed", function() {
        expect(getMiddlewares(apiRouter, 'delete', '/call-url/:token'))
          .include(validateToken);
      });
    });

    describe("GET /calls", function() {
      var req, calls;

      beforeEach(function(done) {
        calls = [
          {
           callId: randomBytes(16).toString("hex"),
           wsCallerToken: randomBytes(16).toString("hex"),
           wsCalleeToken: randomBytes(16).toString("hex"),
           callerId: callerId,
           userMac: userHmac,
           apiKey: tokBoxConfig.credentials.default.apiKey,
           sessionId: fakeCallInfo.session1,
           calleeToken: fakeCallInfo.token1,
           callToken: callToken,
           callType: 'audio',
           urlCreationDate: urlCreationDate,
           callState: constants.CALL_STATES.INIT,
           timestamp: parseInt(Date.now() / 1000, 10)
          },
          {
           callId: randomBytes(16).toString("hex"),
           wsCallerToken: randomBytes(16).toString("hex"),
           wsCalleeToken: randomBytes(16).toString("hex"),
           callerId: callerId,
           userMac: userHmac,
           apiKey: tokBoxConfig.credentials.default.apiKey,
           sessionId: fakeCallInfo.session2,
           calleeToken: fakeCallInfo.token2,
           callToken: callToken,
           callType: 'audio-video',
           urlCreationDate: urlCreationDate,
           callState: constants.CALL_STATES.INIT,
           timestamp: parseInt(Date.now() / 1000, 10) + 1
          },
          {
           callId: randomBytes(16).toString("hex"),
           wsCallerToken: randomBytes(16).toString("hex"),
           wsCalleeToken: randomBytes(16).toString("hex"),
           callerId: callerId,
           userMac: userHmac,
           apiKey: tokBoxConfig.credentials.default.apiKey,
           sessionId: fakeCallInfo.session3,
           calleeToken: fakeCallInfo.token2,
           callState: constants.CALL_STATES.TERMINATED,
           callToken: callToken,
           callType: 'audio-video',
           urlCreationDate: urlCreationDate,
           timestamp: parseInt(Date.now() / 1000, 10) + 2
          }
        ];

        req = supertest(app)
          .get(apiPrefix + '/calls?version=' + calls[1].timestamp)
          .hawk(hawkCredentials)
          .expect('Content-Type', /json/);

        storage.addUserCall(userHmac, calls[0], function() {
          storage.addUserCall(userHmac, calls[1], function() {
            storage.addUserCall(userHmac, calls[2], done);
          });
        });
      });

      it("should list existing calls", function(done) {
        supertest(app)
          .get(apiPrefix + '/calls?version=0')
          .hawk(hawkCredentials)
          .expect('Content-Type', /json/)
          .expect(200).end(function(err, res) {
            if (err) throw err;

            var callsList = calls.filter(function(call) {
              return call.callState !== constants.CALL_STATES.TERMINATED;
            }).map(function(call) {
              return {
                callId: call.callId,
                callType: call.callType,
                callerId: call.callerId,
                websocketToken: call.wsCalleeToken,
                apiKey: tokBoxConfig.credentials.default.apiKey,
                sessionId: call.sessionId,
                sessionToken: call.calleeToken,
                callUrl: conf.get('callUrls').webAppUrl
                  .replace('{token}', call.callToken),
                call_url: conf.get('callUrls').webAppUrl
                  .replace('{token}', call.callToken),
                callToken: call.callToken,
                urlCreationDate: call.urlCreationDate,
                progressURL: progressURL
              };
            });


            expect(res.body).to.deep.equal({calls: callsList});
            done(err);
          });
      });

      it("should list calls more recent than a given version", function(done) {
        req.expect(200).end(function(err, res) {
          if (err) throw err;

          var callsList = [{
            callId: calls[1].callId,
            callType: calls[1].callType,
            callerId: calls[1].callerId,
            websocketToken: calls[1].wsCalleeToken,
            apiKey: tokBoxConfig.credentials.default.apiKey,
            sessionId: calls[1].sessionId,
            sessionToken: calls[1].calleeToken,
            callUrl: conf.get('callUrls').webAppUrl
              .replace('{token}', calls[2].callToken),
            call_url: conf.get('callUrls').webAppUrl
              .replace('{token}', calls[1].callToken),
            callToken: calls[1].callToken,
            urlCreationDate: calls[1].urlCreationDate,
            progressURL: progressURL
          }];

          expect(res.body).to.deep.equal({calls: callsList});
          done(err);
        });
      });

      it("shouldn't list callToken and urls for a direct call", function(done) {
        var call = {
          callId: randomBytes(16).toString("hex"),
          wsCallerToken: randomBytes(16).toString("hex"),
          wsCalleeToken: randomBytes(16).toString("hex"),
          callerId: callerId,
          userMac: userHmac,
          apiKey: tokBoxConfig.credentials.default.apiKey,
          sessionId: fakeCallInfo.session3,
          calleeToken: fakeCallInfo.token2,
          callState: constants.CALL_STATES.INIT,
          callType: 'audio-video',
          timestamp: parseInt(Date.now() / 1000, 10) + 3
        };

        req = supertest(app)
          .get(apiPrefix + '/calls?version=' + call.timestamp)
          .hawk(hawkCredentials)
          .expect('Content-Type', /json/);

        storage.addUserCall(userHmac, call, function() {
          req.expect(200).end(function(err, res) {
            if (err) throw err;

            var callsList = [{
              callId: call.callId,
              callType: call.callType,
              callerId: call.callerId,
              websocketToken: call.wsCalleeToken,
              apiKey: tokBoxConfig.credentials.default.apiKey,
              sessionId: call.sessionId,
              sessionToken: call.calleeToken,
              progressURL: progressURL
            }];

            expect(res.body).to.deep.equal({calls: callsList});
            done(err);
          });
        });
      });

      it("should have the requireHawk middleware installed", function() {
        expect(getMiddlewares(apiRouter, 'get', '/calls'))
          .include(requireHawkSession);
      });

      it("should answer a 503 if the database isn't available", function(done) {
        sandbox.stub(storage, "getUserCalls", function(userMac, callback) {
          callback("error");
        });

        req.expect(503).end(done);
      });

    });

    describe("with tokens", function() {
      var requests, token, tokBoxSessionId,
          tokBoxCallerToken, tokBoxCalleeToken;

      beforeEach(function (done) {
        requests = [];
        var fakeCallInfo = conf.get("fakeCallInfo");
        sandbox.useFakeTimers(fakeNow);
        tokBoxSessionId = fakeCallInfo.session1;
        tokBoxCalleeToken = fakeCallInfo.token1;
        tokBoxCallerToken = fakeCallInfo.token2;

        sandbox.stub(request, "put", function(options) {
          requests.push(options);
        });

        token = tokenlib.generateToken(callUrls.tokenSize);

        var timestamp = parseInt(Date.now() / 1000, 10);

        storage.addUserCallUrlData(userHmac, token, {
          userMac: userHmac,
          callerId: callerId,
          timestamp: timestamp,
          expires: timestamp + callUrls.timeout
        }, done);
      });

      describe("POST /calls/:token", function() {
        var addCallReq;

        beforeEach(function() {
          addCallReq = supertest(app)
            .post(apiPrefix + '/calls/' + token)
            .send({callType: 'audio-video'})
            .expect(200);
        });

        it("should have the token validation middleware installed", function() {
          expect(getMiddlewares(apiRouter, 'post', '/calls/:token'))
            .include(validateToken);
        });

        it("should have the validateCallType middleware installed",
          function() {
            expect(getMiddlewares(apiRouter, 'post', '/calls'))
              .include(validateCallType);
          });

        describe("With working tokbox APIs", function() {

          beforeEach(function() {
            sandbox.stub(tokBox, "getSessionTokens", function(opts, callback) {
              callback(null, {
                apiKey: tokBoxConfig.credentials.default.apiKey,
                sessionId: tokBoxSessionId,
                callerToken: tokBoxCallerToken,
                calleeToken: tokBoxCalleeToken
              });
            });
          });

          it("should accept valid call token", function(done) {
            addCallReq.end(done);
          });

          it("should return a 503 if urlsStore is not available", function(done) {
            sandbox.stub(storage, "getUserSimplePushURLs", function(userMac, callback) {
              callback("error");
            });
            addCallReq
              .expect(503)
              .end(done);
          });

          it("should return the caller data.", function(done) {
            addCallReq
              .end(function(err, res) {
                if (err) throw err;
                expect(res.body).to.have.property("callId");
                expect(res.body).to.have.property("websocketToken");
                expect(res.body.sessionId).to.eql(tokBoxSessionId);
                expect(res.body.sessionToken).to.eql(tokBoxCallerToken);
                expect(res.body.apiKey).to.eql(
                  tokBoxConfig.credentials.default.apiKey);
                expect(res.body.progressURL).to.eql(progressURL);
                done();
              });
          });

          it("should call the user SimplePushURL.", function(done) {
            var startTime = parseInt(Date.now() / 1000, 10);
            storage.addUserSimplePushURLs(userHmac, hawkIdHmac,
              {calls: pushURL}, function(err) {
                if (err) throw err;
                addCallReq
                  .end(function(err) {
                    if (err) throw err;
                    expect(requests).to.length(1);
                    expect(requests[0]).to.eql({
                      url: pushURL,
                      form: { version: startTime }
                    });
                    done();
                  });
              });
          });

          it("should store call user data.", function(done) {
            addCallReq
              .end(function(err) {
                if (err) throw err;
                storage.getUserCalls(userHmac, function(err, res) {
                  if (err) throw err;
                  expect(res).to.length(1);
                  expect(res[0].callType).to.eql("audio-video");
                  done();
                });
              });
          });

          it("should let the callee grab call info.", function(done) {
            addCallReq
              .end(function(err) {
                if (err) throw err;
                supertest(app)
                  .get(apiPrefix + "/calls?version=200")
                  .hawk(hawkCredentials)
                  .expect(200)
                  .end(function(err, res) {
                    if (err) throw err;
                    expect(res.body.calls).to.length(1);
                    done();
                  });
              });
          });

          it("should store optional subject data.", function(done) {
            addCallReq
              .send({callType: 'audio-video', subject: 'dummySubject'})
              .end(function(err) {
                if (err) throw err;
                storage.getUserCalls(userHmac, function(err, res) {
                  if (err) throw err;
                  expect(res).to.length(1);
                  expect(res[0].callType).to.eql("audio-video");
                  expect(res[0].subject).to.eql("dummySubject");
                  done();
                });
              });
          });

        });
      });

      describe("POST /calls", function() {
        var addCallReq;

        beforeEach(function() {
          addCallReq = supertest(app)
            .post(apiPrefix + "/calls")
            .hawk(hawkCredentials)
            .type("json")
            .expect(200);
        });


        it("should have the requireHawk middleware installed", function() {
          expect(getMiddlewares(apiRouter, "post", "/calls"))
            .include(requireHawkSession);
        });

        it("should have the validateCallType middleware installed",
          function() {
            expect(getMiddlewares(apiRouter, 'post', '/calls'))
              .include(validateCallType);
          });

        it("should have the validateCallParams middleware installed",
          function() {
            expect(getMiddlewares(apiRouter, 'post', '/calls'))
              .include(validateCallParams);
          });

        describe("With working tokbox APIs", function() {
          var _logs = [], oldMetrics;

          beforeEach(function() {
            oldMetrics = conf.get('hekaMetrics');
            var hekaMetrics = JSON.parse(JSON.stringify(oldMetrics));
            hekaMetrics.activated = true;
            conf.set('hekaMetrics', hekaMetrics);
            sandbox.stub(hekaLogger, "info", function(op, log) {
              log.op = op;
              _logs.push(log);
            });

            sandbox.stub(tokBox, "getSessionTokens", function(opts, callback) {
              callback(null, {
                apiKey: tokBoxConfig.credentials.default.apiKey,
                sessionId: tokBoxSessionId,
                callerToken: tokBoxCallerToken,
                calleeToken: tokBoxCalleeToken
              });
            });
          });

          afterEach(function() {
            _logs = [];
            conf.set('hekaMetrics', oldMetrics);
          });

          it("should log metrics with the user hash", function(done) {
            addCallReq
              .send({calleeId: user, callType: 'audio'})
              .end(function() {
                expect(_logs[0].uid).to.eql(userHmac);
                done();
              });
          });

          it("should accept a valid call identity", function(done) {
            storage.addUserSimplePushURLs(userHmac, hawkIdHmac,
              {calls: pushURL}, function(err) {
                if (err) throw err;

                addCallReq
                  .send({calleeId: user, callType: 'audio'})
                  .end(done);
              });
          });

          it("should accept a valid call identity even if the case differs",
            function(done) {
              storage.addUserSimplePushURLs(userHmac, hawkIdHmac,
                {calls: pushURL}, function(err) {
                  if (err) throw err;

                  addCallReq
                    .send({calleeId: user.toUpperCase(), callType: 'audio'})
                    .end(done);
                });
            });

          it("should return a 503 if urlsStore is not available", function(done) {
            sandbox.stub(storage, "getUserSimplePushURLs", function(userMac, callback) {
              callback("error");
            });
            addCallReq
              .send({calleeId: user, callType: "audio"})
              .expect(503)
              .end(done);
          });

          it("should not let anonymous users place a call.", function(done) {
            var token = new Token();
            token.getCredentials(function(tokenId, authKey) {
              var anonymousHawkCredentials = {
                id: tokenId,
                key: authKey,
                algorithm: "sha256"
              };
              var anonymousHawkIdHmac = hmac(tokenId, conf.get('hawkIdSecret'));
              storage.setHawkSession(anonymousHawkIdHmac, authKey,
                function(err) {
                  if (err) throw err;
                  storage.addUserSimplePushURLs(userHmac, hawkIdHmac,
                    {calls: pushURL}, function(err) {
                      if (err) throw err;
                      supertest(app)
                        .post(apiPrefix + "/calls")
                        .hawk(anonymousHawkCredentials)
                        .type("json")
                        .send({calleeId: user, callType: "audio"})
                        .expect(403)
                        .end(function(err, res) {
                          if (err) throw err;
                          expectFormattedError(res, 403, errors.INVALID_AUTH_TOKEN,
                            "You should be a registered user to perform this action.");
                          done();
                        });
                    });
                });
            });
          });


          it("should return the caller data.", function(done) {
            storage.addUserSimplePushURLs(userHmac, hawkIdHmac, {calls: pushURL}, function(err) {
              if (err) throw err;
              storage.addUserSimplePushURLs(userHmac2, hawkIdHmac2, {calls: pushURL2}, function(err) {
                if (err) throw err;
                var startTime = parseInt(Date.now() / 1000, 10);
                addCallReq
                  .send({calleeId: [user, user2], callType: "audio"})
                  .expect(200)
                  .end(function(err, res) {
                    if (err) throw err;
                    expect(res.body).to.have.property("callId");
                    expect(res.body).to.have.property("websocketToken");
                    expect(res.body.sessionId).to.eql(tokBoxSessionId);
                    expect(res.body.sessionToken).to.eql(tokBoxCallerToken);
                    expect(res.body.apiKey).to.eql(
                      tokBoxConfig.credentials.default.apiKey);
                    expect(res.body.progressURL).to.eql(progressURL);
                    expect(requests).to.length(2);
                    expect(requests[0]).to.eql({
                      url: pushURL,
                      form: { version: startTime }
                    });
                    done();
                  });
              });
            });
          });

          it("should store call user data.", function(done) {
            storage.addUserSimplePushURLs(userHmac, hawkIdHmac, {calls: pushURL}, function(err) {
              if (err) throw err;
              storage.addUserSimplePushURLs(userHmac2, hawkIdHmac2, {calls: pushURL2}, function(err) {
                if (err) throw err;

                addCallReq
                  .send({calleeId: [user, user2], callType: "audio"})
                  .expect(200)
                  .end(function(err) {
                    if (err) throw err;
                    storage.getUserCalls(userHmac, function(err, res) {
                      if (err) throw err;
                      expect(res).to.length(1);
                      storage.getUserCalls(userHmac2, function(err, res2) {
                        if (err) throw err;

                        expect(res2).to.length(1);
                        expect(res2).to.eql(res);
                        done();
                      });
                    });
                  });
              });
            });
          });

          it("should let the callee grab call info.", function(done) {
            storage.addUserSimplePushURLs(userHmac, hawkIdHmac, {calls: pushURL}, function(err) {
              if (err) throw err;
              storage.addUserSimplePushURLs(userHmac2, hawkIdHmac2, {calls: pushURL2}, function(err) {
                if (err) throw err;

                addCallReq
                  .send({calleeId: [user, user2], callType: "audio"})
                  .expect(200)
                  .end(function(err) {
                    if (err) throw err;
                    supertest(app)
                      .get(apiPrefix + "/calls?version=200")
                      .hawk(hawkCredentials)
                      .expect(200)
                      .end(function(err, res) {
                        if (err) throw err;
                        expect(res.body.calls).to.length(1);
                        expect(res.body.calls[0]).to.have.property('callerId');
                        supertest(app)
                          .get(apiPrefix + "/calls?version=200")
                          .hawk(hawkCredentials2)
                          .expect(200)
                          .end(function(err, res2) {
                            if (err) throw err;
                            expect(res2.body.calls).to.length(1);

                            delete res.body.calls[0].progressURL;
                            delete res2.body.calls[0].progressURL;
                            expect(res.body.calls).to.eql(res2.body.calls);
                            done();
                          });
                      });
                  });
              });
            });
          });

          it("should fail when calling a non existing user.", function(done) {
            addCallReq
              .send({calleeId: "non-existing@example.com", callType: "audio"})
              .expect(400)
              .end(function(err, res) {
                if (err) throw err;
                expectFormattedError(res, 400, errors.USER_UNAVAILABLE,
                                    "Could not find any existing user to call");
                done();
              });
          });

          it("should 400 when no existing Simple Push URL is registered " +
             "for the called user.",
            function(done) {
              addCallReq
                .send({calleeId: user, callType: "audio"})
                .expect(400)
                .end(function(err, res) {
                  expectFormattedError(res, 400, errors.USER_UNAVAILABLE,
                                      "Could not find any existing user to call");
                  done(err);
                });
            });

          it("should return a 400 if subject is too long", function(done) {
            storage.addUserSimplePushURLs(userHmac, hawkIdHmac, {calls: pushURL}, function(err) {
              if (err) throw err;
              var longSubject = new Array(126).join("~");
              addCallReq
                .send({calleeId: user, subject: longSubject, callType: "audio"})
                .expect(400)
                .end(function(err, res) {
                  if (err) throw err;
                  expectFormattedError(res, 400, errors.INVALID_PARAMETERS,
                                      "Call subject should be shorter than 124 characters");
                  done();
                });
              });
          });

          it("should ping all the user ids URLs", function(done) {
            storage.addUserSimplePushURLs(userHmac, hawkIdHmac, {calls: pushURL}, function(err) {
              if (err) throw err;
              storage.addUserSimplePushURLs(userHmac2, hawkIdHmac2, {calls: pushURL2}, function(err) {
                if (err) throw err;
                storage.addUserSimplePushURLs(userHmac3, hawkIdHmac3, {calls: pushURL3}, function(err) {
                  if (err) throw err;

                  addCallReq
                    .send({
                      calleeId: [
                        user, user2,
                        // French number with French MCC should works
                        {phoneNumber: "0675002145", "mcc": 208},

                        // MSISDN without mcc should works
                        {phoneNumber: "+33675002145"},

                        // MCC doesn't match MSISDN Country Code, should find out
                        {phoneNumber: "+33675002145", mcc: 310},

                        // Will be ignored wrong MSISDN and no MCC
                        {phoneNumber: "0675002145"},

                        // Wrong object will be ignored (no phoneNumber)
                        {number: "+33675002145"}],
                      callType: "audio"
                    })
                    .expect(200)
                    .end(function(err) {
                      if (err) throw err;
                      expect(requests).to.length(5);
                      done();
                    });
                });
              });
            });
          });
        });
      });

      describe("DELETE /account", function() {
        it("should return 204 even if there is no call-data to delete",
          function(done) {
            supertest(app)
              .del(apiPrefix + '/account')
              .hawk(hawkCredentials)
              .expect(204)
              .end(function(err) {
                if (err) throw err;
                done();
              });
          });
      });
    });

    describe("DELETE /session", function() {
      it("should have the requireRegisteredUser middleware installed", function(done) {
        expect(getMiddlewares(apiRouter, 'delete', '/session'))
          .include(requireRegisteredUser);
        done();
      });

      it("should remove the connected user session and drop its simplePushUrls", function(done) {
        supertest(app)
          .post(apiPrefix + '/registration')
          .type('json')
          .send({'simple_push_url': 'http://url'})
          .set("Authorization", "BrowserID " + expectedAssertion)
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            var token = new Token(res.header['hawk-session-token']);
            token.getCredentials(function(tokenId, authKey) {
              hawkIdHmac = hmac(tokenId, conf.get('hawkIdSecret'));
              supertest(app)
                .del(apiPrefix + '/session')
                .hawk({
                  id: tokenId,
                  key: authKey,
                  algorithm: "sha256"
                })
                .expect(204)
                .end(function(err) {
                  if (err) throw err;
                  storage.getUserSimplePushURLs(userHmac, function(err, urls) {
                    if (err) throw err;
                    expect(urls.calls).to.length(0);
                    expect(urls.rooms).to.length(0);
                    storage.getHawkSession(hawkIdHmac, function(err, hawkSession) {
                      if (err) throw err;
                      expect(hawkSession).to.eql(null);
                      done();
                    });
                  });
                });
            });
          });
      });
    });

    describe("POST /event", function() {
      it("should fail if does not have event/label/action.", function(done) {
          supertest(app)
            .post('/event')
            .type('json')
            .expect('Content-Type', /json/)
            .expect(400)
            .end(function(err, res) {
              if (err) throw err;
              expectFormattedError(res, 400, errors.MISSING_PARAMETERS,
                                   "Missing: event, action, label");
              done();
            });
        });

      it("should returns a 401 if no hawk session.", function(done) {
          supertest(app)
            .post('/event')
            .type('json')
            .expect('Content-Type', /json/)
            .send({'event': 'tab_shared',
                   'action': 'clicked',
                   'label': 'Tab shared'})
            .expect(401)
            .end(done);
        });

      it("should returns a 405 if disabled in settings.", function(done) {
          supertest(app)
            .post('/event')
            .type('json')
            .expect('Content-Type', /json/)
            .send({'event': 'tab_shared',
                   'action': 'clicked',
                   'label': 'Tab shared'})
            .hawk(hawkCredentials)
            .expect(405)
            .end(done);
        });

      context("enabled", function() {
        var sendAnalyticsStub;
        beforeEach(function() {
          sendAnalyticsStub = sandbox.stub(analytics, "sendAnalytics");
          conf.set('ga', {
            activated: true,
            id: "fake-ga-id"
          });
        });

        afterEach(function() {
          conf.set('ga', {
            activated: false,
            id: null
          });
        });

        it("should returns a 204 if everything went well.", function(done) {
          supertest(app)
            .post('/event')
            .type('json')
            .send({'event': 'tab_shared',
                   'action': 'clicked',
                   'label': 'Tab shared'})
            .hawk(hawkCredentials)
            .expect(204)
            .end(done);
        });

        it("should pass gaID, userID and body to sendAnalytics.", function(done) {
          supertest(app)
            .post('/event')
            .type('json')
            .send({'event': 'tab_shared',
                   'action': 'clicked',
                   'label': 'Tab shared'})
            .hawk(hawkCredentials)
            .expect(204)
            .end(function(err) {
              if (err) throw err;
              assert.calledWithExactly(sendAnalyticsStub, "fake-ga-id", userHmac, {
                event: 'tab_shared',
                action: 'clicked',
                label: 'Tab shared'
              });
              done();
            });
        });
      });
    });
  });

  describe("GET /api-specs", function() {
    it("should return the Videur api spec file.", function(done) {
        supertest(app)
          .get('/api-specs')
          .type('json')
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(err, res) {
            if (err) throw err;
            var spec = res.body;
            var wantedLocation = conf.get("protocol") + "://" + conf.get("publicServerAddress");
            expect(spec.service.location, wantedLocation);
            expect(spec.service.version, pjson.version);

            var room_tsize = Math.ceil(conf.get('rooms').tokenSize / 3 * 4);
            var expr = 'regexp:/rooms/[a-zA-Z0-9_-]{' + room_tsize + '}';
            expect(!spec.service.resources.hasOwnProperty('__ROOMS__'));
            expect(spec.service.resources.hasOwnProperty(expr));

            var call_tsize = Math.ceil(conf.get('callUrls').tokenSize / 3 * 4);
            expr = 'regexp:/rooms/[a-zA-Z0-9_-]{' + call_tsize + '}';
            expect(!spec.service.resources.hasOwnProperty('__CALLS__'));
            expect(spec.service.resources.hasOwnProperty(expr));

            done();
          });
      });
  });
}

describe("HTTP API exposed by the server", function() {
  runOnPrefix('');
  runOnPrefix(loop.apiPrefix);
});
