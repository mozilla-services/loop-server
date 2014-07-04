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

var loop = require("../loop");
var app = loop.app;
var request = loop.request;
var validateToken = loop.validateToken;
var validateCallType = loop.validateCallType;
var validateSimplePushURL = loop.validateSimplePushURL;
var conf = loop.conf;
var tokBox = loop.tokBox;
var storage = loop.storage;
var statsdClient = loop.statsdClient;
var requireHawkSession = loop.requireHawkSession;
var authenticate = loop.authenticate;
var getProgressURL = require("../loop/utils").getProgressURL;

var Token = require("../loop/token").Token;
var tokenlib = require("../loop/tokenlib");
var fxaAuth = require("../loop/fxa");
var tokBoxConfig = conf.get("tokBox");
var hmac = require("../loop/hmac");

var getMiddlewares = require("./support").getMiddlewares;
var expectFormatedError = require("./support").expectFormatedError;

var fakeNow = 1393595554796;
var user = "alexis@notmyidea.org";
var user2 = "alexis@mozilla.com";
var userHmac, userHmac2;
var callerId = 'natim@mozilla.com';
var callToken = 'call-token';
var urlCreationDate = 1404139145;


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

  var sandbox, expectedAssertion, pushURL, pushURL2, hawkCredentials,
       hawkCredentials2, fakeCallInfo, genuineOrigins;

  var routes = {
    '/': ['get'],
    '/registration': ['post'],
    '/call-url': ['post', 'del'],
    '/calls': ['get', 'post'],
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

    pushURL2 = 'https://push2.services.mozilla.com/update/MGlYke2SrEmYE8ceyu' +
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
      var hawkIdHmac = hmac(tokenId, conf.get('hawkIdSecret'));
      userHmac = hmac(user, conf.get('userMacSecret'));
      storage.setHawkSession(hawkIdHmac, authKey, function(err) {
        if (err) throw err;
        storage.setHawkUser(userHmac, hawkIdHmac, function(err) {
          if (err) throw err;
          // Generate Hawk credentials.
          var token2 = new Token();
          token2.getCredentials(function(tokenId2, authKey2) {
            hawkCredentials2 = {
              id: tokenId2,
              key: authKey2,
              algorithm: "sha256"
            };
            var hawkIdHmac2 = hmac(tokenId2, conf.get('hawkIdSecret'));
            userHmac2 = hmac(user2, conf.get('userMacSecret'));
            storage.setHawkSession(hawkIdHmac2, authKey2, function(err) {
              if (err) throw err;
              storage.setHawkUser(userHmac2, hawkIdHmac2, done);
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

  Object.keys(routes).forEach(function(route) {
    routes[route].forEach(function(method) {
      if (route.indexOf('token') !== -1) {
        var token = tokenlib.generateToken(conf.get("callUrlTokenSize"));
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
      sandbox.stub(request, "post", function(options, callback) {
        callback(null, {statusCode: 200});
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
      sandbox.stub(request, "post", function(options, callback) {
        callback(new Error("blah"));
      });
      supertest(app)
        .get('/__heartbeat__')
        .expect(503)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.body).to.eql({
            'storage': true,
            'provider': false,
            'message': "TokBox Error: The request failed: Error: blah"
          });
          done();
        });
    });

    it("should return a 200 if all dependencies are ok", function(done) {
      sandbox.stub(request, "post", function(options, callback) {
        callback(null, {statusCode: 200});
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

    it("should accept an expiresIn parameter", function(done) {
      jsonReq
        .expect(200)
        .send({callerId: callerId, expiresIn: 5})
        .end(function(err, res) {
          if (err) throw err;
          var callUrl = res.body.callUrl,
              token;

          token = callUrl.split("/").pop();

          storage.getCallUrlData(token, function(err, urlData) {
            if (err) throw err;
            expect(urlData.expires).not.eql(undefined);
            done();
          });
        });
    });

    it("should generate a valid call-url", function(done) {
      jsonReq
        .expect(200)
        .send({callerId: callerId})
        .end(function(err, res) {
          if (err) throw err;
          var callUrl = res.body.callUrl, token;

          expect(callUrl).to.not.equal(null);
          var urlStart = conf.get('webAppUrl').replace('{token}', '');
          expect(callUrl).to.contain(urlStart);

          token = callUrl.split("/").pop();

          storage.getCallUrlData(token, function(err, urlData) {
            if (err) throw err;
            expect(urlData.userMac).not.eql(undefined);
            done();
          });
        });
    });

    it("should return the expiration date of the call-url", function(done) {
      jsonReq
        .expect(200)
        .send({callerId: callerId})
        .end(function(err, res) {
          if (err) throw err;
          var expiresAt = res.body.expiresAt;
          expect(expiresAt).not.eql(undefined);
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

    it("should be able to store multiple push urls for one user",
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

    it("should not override old SimplePush URLs.", function(done) {
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
    it("should have the validateToken middleware installed.", function() {
      expect(getMiddlewares(app, 'get', '/calls/:token'))
        .include(validateToken);
    });

    it("should return a the calleeFriendlyName", function(done) {
      var calleeFriendlyName = "Adam Roach";
      var token = tokenlib.generateToken(conf.get("callUrlTokenSize"));
      storage.addUserCallUrlData(userHmac, token, {
        userMac: userHmac,
        issuer: calleeFriendlyName,
        timestamp: parseInt(Date.now() / 1000, 10),
        expires: parseInt(Date.now() / 1000, 10) + conf.get("callUrlTimeout")
      }, function(err) {
        if (err) throw err;

        supertest(app)
          .get('/calls/' + token)
          .hawk(hawkCredentials)
          .expect(200)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) throw err;
            expect(res.body).to.deep.equal({
              calleeFriendlyName: calleeFriendlyName
            });
            done();
          });
      });
    });
  });

  describe("PUT /call-url/:token", function() {
    var token;
    beforeEach(function(done) {
      token = tokenlib.generateToken(conf.get("callUrlTokenSize"));
      storage.addUserCallUrlData(userHmac, token, {
        timestamp: parseInt(Date.now() / 1000, 10),
        expires: parseInt(Date.now() / 1000, 10) + conf.get("callUrlTimeout")
      }, function(err) {
        if (err) throw err;
        done();
      });
    });

    it("should ignore invalid fields", function(done) {
      supertest(app)
        .put('/call-url/' + token)
        .hawk(hawkCredentials)
        .send({
          callerId: "Adam",
          invalidField: "value"
        })
        .expect(200)
        .end(function(err, res) {
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
        .put('/call-url/' + token)
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
  });

  describe("DELETE /call-url/:token", function() {
    var token, req, clock;

    beforeEach(function(done) {
      clock = sinon.useFakeTimers(fakeNow);

      token = tokenlib.generateToken(conf.get("callUrlTokenSize"));
      storage.addUserCallUrlData(userHmac, token, {
        userMac: userHmac,
        timestamp: parseInt(Date.now() / 1000, 10),
        expires: parseInt(Date.now() / 1000, 10) + conf.get("callUrlTimeout")
      }, function(err) {
        if (err) throw err;
        req = supertest(app)
          .del('/call-url/' + token)
          .hawk(hawkCredentials);
        done();
      });
    });

    afterEach(function() {
      clock.restore();
    });

    it("should remove the call-url", function(done) {
      req.expect(204).end(function(err, res) {
        if (err) throw err;
        storage.getCallUrlData(token, function(err, record) {
          if (err) throw err;
          expect(record).eql(null);
          done();
        });
      });
    });

    it("should return a 503 is the database is not available", function(done) {
      sandbox.stub(storage, "getCallUrlData", function(urlId, cb) {
        cb("error");
      });
      req.expect(503).end(done);
    });

    it("should return a 403 if the token doesn't belong to the user",
      function(done){
        storage.addUserCallUrlData(userHmac, token, {
          userMac: "h4x0r",
          timestamp: parseInt(Date.now() / 1000, 10),
          expires: parseInt(Date.now() / 1000, 10) + conf.get("callUrlTimeout")
        }, function(err) {
          if (err) throw err;
          req = supertest(app)
            .del('/call-url/' + token)
            .hawk(hawkCredentials)
            .expect(403).end(done);
        });
      });

    it("should have the validateToken middleware installed", function() {
      expect(getMiddlewares(app, 'delete', '/call-url/:token'))
        .include(validateToken);
    });
  });

  describe("GET /calls", function() {
    var req, calls;

    beforeEach(function(done) {
      calls = [
        {
          callId:          crypto.randomBytes(16).toString("hex"),
          wsCallerToken:   crypto.randomBytes(16).toString("hex"),
          wsCalleeToken:   crypto.randomBytes(16).toString("hex"),
          callerId:        callerId,
          userMac:         userHmac,
          sessionId:       fakeCallInfo.session1,
          calleeToken:     fakeCallInfo.token1,
          callToken:       callToken,
          callType:        'audio',
          urlCreationDate: urlCreationDate,
          callState:       "init",
          timestamp:       parseInt(Date.now() / 1000, 10)
        },
        {
          callId:          crypto.randomBytes(16).toString("hex"),
          wsCallerToken:   crypto.randomBytes(16).toString("hex"),
          wsCalleeToken:   crypto.randomBytes(16).toString("hex"),
          callerId:        callerId,
          userMac:         userHmac,
          sessionId:       fakeCallInfo.session2,
          calleeToken:     fakeCallInfo.token2,
          callToken:       callToken,
          callType:        'audio-video',
          urlCreationDate: urlCreationDate,
          callState:       "init",
          timestamp:       parseInt(Date.now() / 1000, 10) + 1
        },
        {
          callId:          crypto.randomBytes(16).toString("hex"),
          wsCallerToken:   crypto.randomBytes(16).toString("hex"),
          wsCalleeToken:   crypto.randomBytes(16).toString("hex"),
          callerId:        callerId,
          userMac:         userHmac,
          sessionId:       fakeCallInfo.session3,
          calleeToken:     fakeCallInfo.token2,
          callState:       "terminated",
          callToken:       callToken,
          callType:        'audio-video',
          urlCreationDate: urlCreationDate,
          timestamp:       parseInt(Date.now() / 1000, 10) + 2
        },
      ];

      req = supertest(app)
        .get('/calls?version=' + calls[2].timestamp)
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
        .get('/calls?version=0')
        .hawk(hawkCredentials)
        .expect('Content-Type', /json/)
        .expect(200).end(function(err, res) {
          if (err) throw err;

          var callsList = calls.map(function(call) {
            return {
              callId: call.callId,
              callType: call.callType,
              callerId: call.callerId,
              websocketToken: call.wsCalleeToken,
              apiKey: tokBoxConfig.apiKey,
              sessionId: call.sessionId,
              sessionToken: call.calleeToken,
              callUrl: conf.get('webAppUrl').replace('{token}', call.callToken),
              urlCreationDate: call.urlCreationDate,
              progressURL: getProgressURL(res.req._headers.host)
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
          callId: calls[2].callId,
          callType: calls[2].callType,
          callerId: calls[2].callerId,
          websocketToken: calls[2].wsCalleeToken,
          apiKey: tokBoxConfig.apiKey,
          sessionId: calls[2].sessionId,
          sessionToken: calls[2].calleeToken,
          callUrl: conf.get('webAppUrl').replace('{token}', calls[2].callToken),
          urlCreationDate: calls[2].urlCreationDate,
          progressURL: getProgressURL(res.req._headers.host)
        }];

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

      req.expect(503).end(done);
    });

  });

  describe("with tokens", function() {
    var requests, token, jsonReq, tokBoxSessionId,
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

      jsonReq = supertest(app)
        .post('/calls/' + token)
        .send()
        .expect(200);

      token = tokenlib.generateToken(conf.get("callUrlTokenSize"));

      var timestamp = parseInt(Date.now() / 1000, 10);

      storage.addUserCallUrlData(userHmac, token, {
        userMac: userHmac,
        callerId: callerId,
        timestamp: timestamp,
        expires: timestamp + conf.get("callUrlTimeout")
      }, done);
    });

    describe("POST /calls/:token", function() {
      var emptyReq, addCallReq;

      beforeEach(function() {
        emptyReq = supertest(app).post('/calls/' + token);
        addCallReq = supertest(app)
          .post('/calls/' + token)
          .send({callType: 'audio-video'})
          .expect(200);
      });

      it("should have the token validation middleware installed", function() {
        expect(getMiddlewares(app, 'post', '/calls/:token'))
          .include(validateToken);
      });

      it("should have the validateCallType middleware installed",
        function() {
          expect(getMiddlewares(app, 'post', '/calls'))
            .include(validateCallType);
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
          addCallReq.end(done);
        });

        it("should return a 503 if urlsStore is not available", function(done) {
          sandbox.stub(storage, "getUserSimplePushURLs", function(userMac, cb) {
            cb("error");
          });
          addCallReq
            .expect(503)
            .end(done);
        });

        it("should return the caller data.", function(done) {
          addCallReq
            .end(function(err, res) {
              expect(res.body).to.have.property("callId");
              expect(res.body).to.have.property("websocketToken");
              expect(res.body.sessionId).to.eql(tokBoxSessionId);
              expect(res.body.sessionToken).to.eql(tokBoxCallerToken);
              expect(res.body.apiKey).to.eql(tokBox.apiKey);
              expect(res.body.progressURL).to.eql(
                "ws://" + res.req._headers.host);
              done();
            });
        });

        it("should store call users data.", function(done) {
          addCallReq
            .end(function(err, res) {
              storage.getUserCalls(userHmac, function(err, res) {
                if (err) throw err;
                expect(res).to.length(1);
                done();
              });
            });
        });

        it("should let the callee grab call info.", function(done) {
          addCallReq
            .end(function(err, res) {
              supertest(app)
                .get("/calls?version=200")
                .hawk(hawkCredentials)
                .expect(200)
                .end(function(err, res) {
                  if (err) throw err;
                  expect(res.body.calls).to.length(1);
                  done();
                });
            });
        });
      });
    });

    describe("POST /calls", function() {
      var emptyReq, addCallReq;

      beforeEach(function() {
        emptyReq = supertest(app)
          .post("/calls")
          .hawk(hawkCredentials)
          .type("json");
        addCallReq = supertest(app)
          .post("/calls")
          .hawk(hawkCredentials)
          .type("json")
          .expect(200);
      });

      it("should have the requireHawk middleware installed", function() {
        expect(
          getMiddlewares(app, "post", "/calls")).include(requireHawkSession);
      });

      it("should have the validateCallType middleware installed",
        function() {
          expect(getMiddlewares(app, 'post', '/calls'))
            .include(validateCallType);
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

        it("should accept a valid call identity", function(done) {
          storage.addUserSimplePushURL(userHmac, pushURL, function(err) {
            if (err) throw err;

            addCallReq
              .send({calleeId: user, callType: 'audio'})
              .end(done);
          });
        });

        it("should return a 503 if urlsStore is not available", function(done) {
          sandbox.stub(storage, "getUserSimplePushURLs", function(userMac, cb) {
            cb("error");
          });
          addCallReq
            .send({calleeId: user, callType: "audio"})
            .expect(503)
            .end(done);
        });

        it("should return the caller data.", function(done) {
          storage.addUserSimplePushURL(userHmac, pushURL, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURL(userHmac2, pushURL2, function(err) {
              if (err) throw err;

              addCallReq
                .send({calleeId: [user, user2], callType: "audio"})
                .expect(200)
                .end(function(err, res) {
                  expect(res.body).to.have.property("callId");
                  expect(res.body).to.have.property("websocketToken");
                  expect(res.body.sessionId).to.eql(tokBoxSessionId);
                  expect(res.body.sessionToken).to.eql(tokBoxCallerToken);
                  expect(res.body.apiKey).to.eql(tokBox.apiKey);
                  expect(res.body.progressURL).to.eql(
                    "ws://" + res.req._headers.host);
                  done();
                });
            });
          });
        });

        it("should store call users data.", function(done) {
          storage.addUserSimplePushURL(userHmac, pushURL, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURL(userHmac2, pushURL2, function(err) {
              if (err) throw err;

              addCallReq
                .send({calleeId: [user, user2], callType: "audio"})
                .expect(200)
                .end(function(err, res) {
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
          storage.addUserSimplePushURL(userHmac, pushURL, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURL(userHmac2, pushURL2, function(err) {
              if (err) throw err;

              addCallReq
                .send({calleeId: [user, user2], callType: "audio"})
                .expect(200)
                .end(function(err, res) {
                  supertest(app)
                    .get("/calls?version=200")
                    .hawk(hawkCredentials)
                    .expect(200)
                    .end(function(err, res) {
                      if (err) throw err;
                      expect(res.body.calls).to.length(1);
                      supertest(app)
                        .get("/calls?version=200")
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
              expect(res.body).to.match(/No user to call found/);
              done();
            });
        });

        it("should fail when calling a user without any SimplePushURLs.",
          function(done) {
            addCallReq
              .send({calleeId: user, callType: "audio"})
              .expect(400)
              .end(function(err, res) {
                expect(res.body).to.match(/No user to call found/);
              done(err);
              });
          });

        it("should ping all the user ids URLs", function(done) {
          storage.addUserSimplePushURL(userHmac, pushURL, function(err) {
            if (err) throw err;
            storage.addUserSimplePushURL(userHmac2, pushURL2, function(err) {
              if (err) throw err;

              addCallReq
                .send({calleeId: [user, user2], callType: "audio"})
                .expect(200)
                .end(function(err, res) {
                  expect(requests).to.length(2);
                  done();
                });
            });
          });
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
          .send({callerId: "foo", callType: "audio"})
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
        baseReq.expect(200).end(function(req, res) {
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
          .send({callerId: "foo", callType: "audio"})
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
