/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var expect = require("chai").expect;
var supertest = require("supertest");
var sinon = require("sinon");

var app = require("../loop").app;
var request = require('../loop').request;
var urlsStore = require("../loop").urlsStore;
var callsStore = require("../loop").callsStore;
var validateToken = require("../loop").validateToken;
var corsEnabled = require("../loop").corsEnabled;
var conf = require("../loop").conf;
var hmac = require("../loop").hmac;
var tokBox = require("../loop").tokBox;

var tokenlib = require("../loop/tokenlib");
var auth = require("../loop/authentication");
var sessions = require("../loop/sessions");
var tokBoxConfig = conf.get("tokBox");

var ONE_MINUTE = 60 * 60 * 1000;
var fakeNow = 1393595554796;
var user = "alexis@notmyidea.org";
var userHmac = hmac(user, conf.get("userMacSecret"));
var uuid = "1234";

function getMiddlewares(method, url) {
  return app.routes[method].filter(function(e){
    return e.path === url;
  }).shift().callbacks;
}

function intersection(array1, array2) {
  return array1.filter(function(n) {
    return array2.indexOf(n) !== -1;
  });
}

function register(url, assertion, cookie, cb) {
  supertest(app)
    .post('/registration')
    .set('Authorization', 'BrowserID ' + assertion)
    .set('Cookie', cookie)
    .type('json')
    .send({'simple_push_url': url})
    .expect(200)
    .end(function(err, resp) {
      if (err) {
        throw err;
      }
      cb(resp);
    });
}

// Create a route to retrieve cookies only
app.get('/get-cookies', function(req, res) {
  req.session.uid = user;
  res.send(200);
});

describe("HTTP API exposed by the server", function() {

  var sandbox, expectedAssertion, pushURL, sessionCookie, fakeCallInfo;

  beforeEach(function(done) {
    sandbox = sinon.sandbox.create();
    expectedAssertion = "BID-ASSERTION";
    fakeCallInfo = conf.get("fakeCallInfo");

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

    supertest(app).get('/get-cookies').end(function(err, res) {
      sessionCookie = res.headers['set-cookie'][0];
      done(err);
    });
  });

  afterEach(function(done) {
    sandbox.restore();
    urlsStore.drop(function() {
      callsStore.drop(function() {
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
          ["name", "description", "version", "homepage", "endpoint"]
          .forEach(function(key) {
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
        .send({})
        .set('Authorization', 'BrowserID ' + expectedAssertion)
        .set('Cookie', sessionCookie)
        .type('json')
        .expect('Content-Type', /json/);
    });

    it.skip("should have the authentication middleware installed", function() {
      expect(getMiddlewares('post', '/call-url')).include(auth.isAuthenticated);
    });

    it("should have the requireSession middleware installed", function() {
      expect(getMiddlewares('post', '/call-url'))
        .include(sessions.requireSession);
    });

    it("should generate a valid call-url", function(done) {
      var clock = sinon.useFakeTimers(fakeNow);
      var tokenManager = new tokenlib.TokenManager({
        macSecret: conf.get('macSecret'),
        encryptionSecret: conf.get('encryptionSecret')
      });

      jsonReq
        .set('Cookie', sessionCookie)
        .expect(200)
        .end(function(err, res) {
          var callUrl = res.body && res.body.call_url, token;

          expect(callUrl).to.not.equal(null);
          expect(callUrl).to.match(/^http:\/\/127.0.0.1/);

          // XXX: the content of the token should change in the
          // future.
          token = callUrl.split("/").pop();
          var decoded = tokenManager.decode(token);
          expect(decoded.expires).eql(
            Math.round((fakeNow / ONE_MINUTE) + tokenManager.timeout)
          );
          expect(decoded.hasOwnProperty('uuid'));

          clock.restore();
          done(err);
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
        .set('Authorization', 'BrowserID ' + expectedAssertion)
        .set('Cookie', sessionCookie)
        .type('json')
        .expect('Content-Type', /json/);
    });

    it.skip("should have the authentication middleware installed", function() {
      expect(getMiddlewares('post', '/registration'))
        .include(auth.isAuthenticated);
    });

    it("should have the attachSession middleware installed", function() {
      expect(getMiddlewares('post', '/registration'))
        .include(sessions.attachSession);
    });

    it("should require simple push url", function(done) {
      jsonReq
        .send({}) // XXX sending nothing fails here, investigate
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.body.error).eql('missing: simple_push_url');
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
      supertest(app)
        .post('/registration')
        .set('Accept', 'text/html')
        .set('Authorization', 'BrowserID ' + expectedAssertion)
        .set('Cookie', sessionCookie)
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
        .send({})
        .set('Cookie', sessionCookie)
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
        .set('Cookie', sessionCookie)
        .expect(200).end(function(err, res) {
          if (err) {
            throw err;
          }

          urlsStore.findOne({userMac: userHmac}, function(err, record) {
            if (err) {
              throw err;
            }

            expect(record.simplepushURL).eql(pushURL);
            done();
          });
        });
    });

    // XXX Bug 980289
    it.skip("should be able to store multiple push urls for one user",
      function(done) {
        register(url1, expectedAssertion, sessionCookie, function() {
          register(url2, expectedAssertion, sessionCookie, function() {
            urlsStore.find({userMac: userHmac}, function(err, records) {
              if (err) {
                throw err;
              }
              expect(records.length).eql(2);
              done();
            });
          });
        });
      });

    it("should be able to override an old SimplePush URL.", function(done) {
      register(url1, expectedAssertion, sessionCookie, function() {
        register(url2, expectedAssertion, sessionCookie, function() {
          urlsStore.find({userMac: userHmac}, function(err, records) {
            if (err) {
              throw err;
            }
            expect(records.length).eql(1);
            done();
          });
        });
      });
    });

    it("should return a 503 if the database isn't available", function(done) {
      sandbox.stub(urlsStore, "updateOrCreate", function(query, record, cb) {
        cb("error");
      });
      jsonReq
        .send({'simple_push_url': pushURL})
        .expect(503).end(done);
    });

    it("should return a 503 if the database isn't available on update",
    function(done) {
      sandbox.stub(urlsStore, "updateOrCreate", function(criteria, newObj, cb) {
        cb("error");
      });
      jsonReq
        .send({
          'simple_push_url': pushURL,
          'previous_simple_push_url': 'http://old'
        }).expect(503).end(done);
    });

  });

  describe("OPTIONS /calls/:token", function() {
    var genuineOrigins = conf.get('allowedOrigins');

    beforeEach(function() {
      conf.set('allowedOrigins', ['http://mozilla.org', 'http://mozilla.com']);
    });

    afterEach(function() {
      conf.set('allowedOrigins', genuineOrigins);
    });

    it("should authorize allowed origins to to CORS", function(done) {
      supertest(app)
        .options('/calls/token')
        .set('Origin', 'http://mozilla.org')
        .expect('Access-Control-Allow-Origin', 'http://mozilla.org')
        .expect('Access-Control-Allow-Methods', 'GET,HEAD,PUT,POST,DELETE')
        .end(done);
    });

    it("should reject unauthorized origins to do CORS", function(done) {
      supertest(app)
        .options('/calls/token')
        .set('Origin', 'http://not-authorized')
        .end(function(err, res) {
          expect(res.headers)
            .not.to.have.property('Access-Control-Allow-Origin');
          done();
        });
    });

    it("should have the cors middleware installed.", function() {
      expect(getMiddlewares('options', '/calls/:token')).include(corsEnabled);
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
        user: user
      });
      supertest(app)
        .get('/calls/' + token)
        .expect("Location", conf.get("webAppUrl").replace("{token}", token))
        .expect(302).end(done);
    });

    it("should have the validateToken middleware installed.", function() {
      expect(getMiddlewares('get', '/calls/:token')).include(validateToken);
    });

    it("should have the cors middleware installed.", function() {
      expect(getMiddlewares('get', '/calls/:token')).include(corsEnabled);
    });
  });

  describe("GET /calls", function() {
    var req, calls;

    beforeEach(function(done) {
      req = supertest(app)
        .get('/calls')
        .set('Authorization', 'BrowserID ' + expectedAssertion)
        .set('Cookie', sessionCookie)
        .expect('Content-Type', /json/);

      calls = [
        {
          caller:       "foo",
          userMac:      userHmac,
          sessionId:    fakeCallInfo.session1,
          calleeToken:  fakeCallInfo.token1,
          timestamp:    0
        },
        {
          caller:       "foo",
          userMac:      userHmac,
          sessionId:    fakeCallInfo.session2,
          calleeToken:  fakeCallInfo.token2,
          timestamp:    1
        },
        {
          caller:       "bar",
          userMac:      userHmac,
          sessionId:    fakeCallInfo.session3,
          calleeToken:  fakeCallInfo.token2,
          timestamp:    2
        }
      ];

      callsStore.add(calls[0], function() {
        callsStore.add(calls[1], function() {
          callsStore.add(calls[2], done);
        });
      });
    });

    it("should list existing calls", function(done) {
      var callsList = calls.map(function(call) {
        return {
          apiKey: tokBoxConfig.apiKey,
          sessionId: call.sessionId,
          sessionToken: call.calleeToken
        };
      });

      req.query({version: 0}).expect(200).end(function(err, res) {
        expect(res.body).to.deep.equal({calls: callsList});
        done(err);
      });
    });

    it("should list calls more recent than a given version", function(done) {
      var callsList = [{
        apiKey: tokBoxConfig.apiKey,
        sessionId: calls[2].sessionId,
        sessionToken: calls[2].calleeToken
      }];

      req.query({version: 2}).expect(200).end(function(err, res) {
        expect(res.body).to.deep.equal({calls: callsList});
        done(err);
      });
    });

    it.skip("should have the authentication middleware installed", function() {
      expect(getMiddlewares('get', '/calls'))
        .include(auth.isAuthenticated);
    });

    it("should have the requireSession middleware installed", function() {
      expect(getMiddlewares('get', '/calls'))
        .include(sessions.requireSession);
    });

    it("should answer a 503 if the database isn't available", function(done) {
      sandbox.stub(callsStore, "find", function(record, cb) {
        cb("error");
      });

      req.query({version: 0}).expect(503).end(done);
    });

  });

  describe("POST /calls/:token", function() {

    var emptyReq, requests, tokenManager, token, jsonReq, tokBoxSessionId,
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
        user: user
      });

      sandbox.stub(request, "put", function(options) {
        requests.push(options);
      });

      emptyReq = supertest(app).post('/calls/' + token);
      jsonReq = supertest(app).post('/calls/' + token)
        .send({nickname: "foo"}).expect(200);
    });

    it("should have the token validation middleware installed", function() {
      expect(getMiddlewares('post', '/calls/:token')).include(validateToken);
    });

    it("should have the cors middleware installed.", function() {
      expect(getMiddlewares('post', '/calls/:token')).include(corsEnabled);
    });

    it("should require a nickname parameter", function(done) {
      emptyReq.send({}).expect(400).end(function(err, res) {
        if (err) throw err;
        expect(res.body.error).eql('missing: nickname');
        done();
      });
    });

    it("should return a 503 if tokbox API errors out", function(done) {
      sandbox.stub(tokBox, "getSessionTokens", function(cb) {
        cb("error");
      });
      jsonReq
        .expect(503)
        .end(done);
    });

    describe("with working tokbox APIs", function() {
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

      it.skip("should trigger all the simple push URLs of the user",
        function(done) {
          var url1 = "http://www.example.org";
          var url2 = "http://www.mozilla.org";

          register(url1, expectedAssertion, sessionCookie, function() {
            register(url2, expectedAssertion, sessionCookie, function() {
              jsonReq.end(function(err, res) {
                if (err) {
                  throw err;
                }
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
            if (err) {
              throw err;
            }
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
            if (err) {
              throw err;
            }

            callsStore.find({userMac: userHmac}, function(err, items) {
              if (err) {
                throw err;
              }
              expect(items.length).eql(1);
              // We don't want to compare this, it's added by mongo.
              delete items[0]._id;
              expect(items[0]).eql({
                caller: "foo",
                uuid: uuid,
                userMac: userHmac,
                sessionId: tokBoxSessionId,
                calleeToken: tokBoxCalleeToken,
                timestamp: fakeNow
              });
              done();
            });
          });
        });

      it("should return a 503 if callsStore is not available", function(done) {
        sandbox.stub(callsStore, "add", function(record, cb) {
          cb("error");
        });
        jsonReq
          .expect(503)
          .end(done);
      });

      it("should return a 503 if urlsStore is not available", function(done) {
        sandbox.stub(urlsStore, "find", function(query, cb) {
          cb("error");
        });
        jsonReq
          .expect(503)
          .end(done);
      });
    });

  });
});
