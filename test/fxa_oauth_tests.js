/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this
* file, You can obtain one at http://mozilla.org/MPL/2.0/. */
'use strict';
var expect = require("chai").expect;
var addHawk = require("superagent-hawk");
var supertest = addHawk(require("supertest"));
var sinon = require("sinon");
var assert = sinon.assert;
var Token = require("express-hawkauth").Token;
var request = require("request");

var loop = require("../loop");
var apiPrefix = loop.apiPrefix;
var apiRouter = loop.apiRouter;
var hmac = require("../loop/hmac");
var errors = require("../loop/errno.json");

var getMiddlewares = require("./support").getMiddlewares;
var expectFormattedError = require("./support").expectFormattedError;

var attachOrCreateOAuthHawkSession = loop.auth.attachOrCreateOAuthHawkSession;
var statsdClient = loop.statsdClient;

var conf = loop.conf;
var oauthConf = conf.get('fxaOAuth');
var app = loop.app;
var storage = loop.storage;
var decrypt = require("../loop/encrypt").decrypt;


describe('/fxa-oauth', function () {
  var hawkCredentials, hawkIdHmac, hawkId, sandbox;

  beforeEach(function(done) {
    sandbox = sinon.sandbox.create();

    // Generate Hawk credentials.
    var token = new Token();
    token.getCredentials(function(tokenId, authKey) {
      hawkCredentials = {
        id: tokenId,
        key: authKey,
        algorithm: "sha256"
      };
      hawkId = tokenId;
      hawkIdHmac = hmac(tokenId, conf.get('hawkIdSecret'));
      storage.setHawkSession(hawkIdHmac, authKey, function(err) {
        if (err) throw err;
        done();
      });
    });
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('POST /params', function() {
    it('should return the stored parameters from the config', function(done) {
      supertest(app)
        .post(apiPrefix + '/fxa-oauth/params')
        .expect(200)
        .end(function(err, resp) {
          if (err) throw err;
          expect(resp.body.client_id).eql(oauthConf.client_id);
          expect(resp.body.oauth_uri).eql(oauthConf.oauth_uri);
          expect(resp.body.content_uri).eql(oauthConf.content_uri);
          expect(resp.body.profile_uri).eql(oauthConf.profile_uri);
          expect(resp.body.scope).eql(oauthConf.scope);
          expect(resp.body.redirect_uri).eql(oauthConf.redirect_uri);
          expect(resp.body.state).to.not.eql(undefined);
          done();
        });
    });

    it('should return the existing state if it does exist', function(done) {
      storage.setHawkOAuthState(hawkIdHmac, "1234", function(err) {
        if (err) throw err;
        supertest(app)
          .post(apiPrefix + '/fxa-oauth/params')
          .hawk(hawkCredentials)
          .expect(200)
          .end(function(err, resp) {
            if (err) throw err;
            expect(resp.body.state).eql("1234");
            done();
          });
      });
    });

    it("should not accept an non OAuth Hawk Session token.", function(done) {
      supertest(app)
        .post(apiPrefix + '/fxa-oauth/params')
        .hawk(hawkCredentials)
        .expect(401)
        .end(done);
    });

    it("should have the attachOrCreateOAuthHawkSession middleware installed",
       function() {
         expect(getMiddlewares(apiRouter, 'post', '/fxa-oauth/params'))
           .include(attachOrCreateOAuthHawkSession);
       });

    it("should return a 503 if the database isn't available",
      function(done) {
        sandbox.stub(storage, "setHawkSession",
          function(tokenId, authKey, callback) {
            callback(new Error("error"));
          });
        supertest(app)
          .post(apiPrefix + '/fxa-oauth/params')
          .type('json')
          .send({}).expect(503).end(done);
      });

      it("should count new users if the session is created", function(done) {
        sandbox.stub(statsdClient, "count");
        supertest(app)
          .post(apiPrefix + '/fxa-oauth/params')
          .type('json')
          .send({}).expect(200).end(function(err) {
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
  });

  describe('GET /token', function() {
    beforeEach(function(done) {
      storage.setHawkOAuthState(hawkIdHmac, "1234", done);
    });

    it('should return the stored OAuth token if there is one', function(done) {
      storage.setHawkOAuthToken(hawkIdHmac, "1234", function(err) {
        if (err) throw err;
        supertest(app)
          .get(apiPrefix + '/fxa-oauth/token')
          .hawk(hawkCredentials)
          .expect(200)
          .end(function(err, resp) {
            if (err) throw err;
            expect(resp.body.access_token).eql("1234");
            done();
          });
      });
    });

    it('should return an empty token if none exists yet', function(done) {
      supertest(app)
        .get(apiPrefix + '/fxa-oauth/token')
        .hawk(hawkCredentials)
        .expect(200)
        .end(function(err, resp) {
          if (err) throw err;
          expect(resp.body.access_token).eql(undefined);
          done();
        });
    });
  });

  describe('POST /token', function() {
    beforeEach(function(done) {
      storage.setHawkOAuthState(hawkIdHmac, "1234", done);
    });

    it('should error out if no state is given', function(done) {
      supertest(app)
        .post(apiPrefix + '/fxa-oauth/token')
        .send({ code: '1234' })
        .hawk(hawkCredentials)
        .expect(400)
        .end(done);
    });

    it('should error out if no code is given', function(done) {
      supertest(app)
        .post(apiPrefix + '/fxa-oauth/token')
        .send({ state: '1234' })
        .hawk(hawkCredentials)
        .expect(400)
        .end(done);
    });

    it('should error out if the state does not match', function(done) {
      storage.setHawkOAuthState(hawkIdHmac, "1234", function(err) {
        if (err) throw err;
        supertest(app)
          .post(apiPrefix + '/fxa-oauth/token')
          .send({ code: '1234', state: '5678' })
          .hawk(hawkCredentials)
          .expect(400)
          .end(function(err, res) {
            if (err) throw err;
            expectFormattedError(
              res, 400, errors.INVALID_OAUTH_STATE, "Invalid OAuth state");

            storage.getHawkOAuthState(hawkIdHmac, function(err, state) {
              if (err) throw err;
              expect(state).to.not.eql(null);
              expect(state).to.not.eql('5678');
              done();
            });
          });
      });
    });

    it('should accept requests even after a POST on /token', function(done) {
      storage.setHawkOAuthState(hawkIdHmac, "1234", function(err) {
        if (err) throw err;
        supertest(app)
          .post(apiPrefix + '/fxa-oauth/token')
          .send({ code: '1234', state: '5678' })
          .hawk(hawkCredentials)
          .expect(400)
          .end(function(err) {
            if (err) throw err;
            supertest(app)
              .post(apiPrefix + '/fxa-oauth/params')
              .hawk(hawkCredentials)
              .expect(200)
              .end(done);
          });
      });
    });

    it('should error when request to the oauth server fails', function(done) {
      sandbox.stub(request, "post", function(options, callback) {
        callback("error");
      });

      storage.setHawkOAuthState(hawkIdHmac, "5678", function(err) {
        if (err) throw err;
        supertest(app)
          .post(apiPrefix + '/fxa-oauth/token')
          .send({ code: '1234', state: '5678' })
          .hawk(hawkCredentials)
          .expect(503)
          .end(done);
      });
    });

    it('should error if the request to the profile fails', function(done) {
      sandbox.stub(request, "post", function(options, callback) {
        callback(null, null, {access_token: "token"});
      });

      sandbox.stub(request, "get", function(options, callback) {
        callback("error");
      });

      storage.setHawkOAuthState(hawkIdHmac, "5678", function(err) {
        if (err) throw err;
        supertest(app)
          .post(apiPrefix + '/fxa-oauth/token')
          .send({ code: '1234', state: '5678' })
          .hawk(hawkCredentials)
          .expect(503)
          .end(done);
      });
    });

    it('should error if the request to the profile does not have an email',
      function(done) {
        sandbox.stub(request, "post", function(options, callback) {
          callback(null, null, {access_token: "token"});
        });

        sandbox.stub(request, "get", function(options, callback) {
          callback(null, null, {error: "500"});
        });

        storage.setHawkOAuthState(hawkIdHmac, "5678", function(err) {
          if (err) throw err;
          supertest(app)
            .post(apiPrefix + '/fxa-oauth/token')
            .send({ code: '1234', state: '5678' })
            .hawk(hawkCredentials)
            .expect(503)
            .end(done);
        });
      });

    it('should error if the returned json is invalid', function(done) {
      sandbox.stub(request, "post", function(options, callback) {
        callback(null, null, {access_token: "token"});
      });

      sandbox.stub(request, "get", function(options, callback) {
        callback(null, null, "{"); // this is invalid JSON.
      });

      storage.setHawkOAuthState(hawkIdHmac, "5678", function(err) {
        if (err) throw err;
        supertest(app)
          .post(apiPrefix + '/fxa-oauth/token')
          .send({ code: '1234', state: '5678' })
          .hawk(hawkCredentials)
          .expect(503)
          .end(done);
      });
    });

    it('should return and store the oauth token', function(done) {
      sandbox.stub(request, "post", function(options, callback) {
        callback(null, null, {access_token: "token"});
      });

      sandbox.stub(request, "get", function(options, callback) {
        callback(null, null, '{"email":"alexis@mozilla.com"}');
      });

      storage.setHawkOAuthState(hawkIdHmac, "5678", function(err) {
        if (err) throw err;
        supertest(app)
          .post(apiPrefix + '/fxa-oauth/token')
          .send({ code: '1234', state: '5678' })
          .hawk(hawkCredentials)
          .expect(200)
          .end(function(err, resp) {
            if (err) throw err;
            expect(resp.body.access_token).eql("token");
            storage.getHawkOAuthToken(hawkIdHmac, function(err, token) {
              if (err) throw err;
              expect(token).eql("token");

              // Should store the email hashed once retrieved.
              var userHmac = hmac("alexis@mozilla.com",
                                  conf.get('userMacSecret'));
              storage.getHawkUser(hawkIdHmac, function(err, retrievedData) {
                if (err) throw err;
                expect(retrievedData).eql(userHmac);
                storage.getHawkUserId(hawkIdHmac, function(err, encryptedUserId) {
                  if (err) throw err;
                  expect(decrypt(hawkId, encryptedUserId)).to.eql("alexis@mozilla.com");
                  done();
                });
              });
            });
          });
      });
    });
  });
});
