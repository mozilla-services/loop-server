/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* jshint expr: true */
'use strict';

var expect = require('chai').expect;
var supertest = require('supertest');
var sinon = require('sinon');

var loop = require('../loop');
var app = loop.app;
var fxaOauth = require('../loop/fxa_oauth')(loop.conf, loop.logError);

describe('fxa oauth endpoints', function () {

  describe('parameters', function () {
    it('should return oauth parameters and set session', function (done) {
      supertest(app)
        .post('/fxa-oauth/params')
        .expect(200)
        .end(function (err, res) {
          expect(res.body.state).to.not.be.undefined;
          expect(res.body.client_id).to.not.be.undefined;
          expect(res.body.profile_uri).to.not.be.undefined;
          expect(res.body.scope).to.not.be.undefined;
          expect(res.body.action).to.not.be.undefined;
          done();
        });
    });
  });

  describe('token request mocks', function () {
    var sandbox;
    var cookies;
    var state;

    beforeEach(function (done) {
      sandbox = sinon.sandbox.create();

      supertest(app)
        .post('/fxa-oauth/params')
        .expect(200)
        .end(function (err, res) {
          cookies = res.headers['set-cookie'];
          state = res.body.state;
          done();
        });
    });

    afterEach(function() {
      sandbox.restore();
    });

    it('should fetch the token from the profile server', function (done) {
      // Mock profile server response
      sandbox.stub(fxaOauth.request, 'post', function (opts, cb) {
        cb(null, 'message', {
          token_type: '1',
          access_token: '1',
          scopes: 'profile'
        });
      });

      var req = supertest(app).post('/fxa-oauth/token');
      req.cookies = cookies;
      req.send({ state: state, client_id: '1', code: '1' })
        .expect(200)
        .end(function (err, res) {
          expect(res.body.token_type).to.not.be.undefined;
          expect(res.body.access_token).to.not.be.undefined;
          expect(res.body.scopes).to.not.be.undefined;
          done();
        });
    });

    it('should handle profile server error', function (done) {
      // Mock profile server response
      sandbox.stub(fxaOauth.request, 'post', function (opts, cb) {
        cb({ code: 404,  errno: 999 }, null, null);
      });

      var req = supertest(app).post('/fxa-oauth/token');
      req.cookies = cookies;
      req.send({ state: state, client_id: '1', code: '1' })
        .expect(200)
        .end(function (err, res) {
          expect(res.body).to.be.equal('Service unavailable');
          done();
        });
    });

  });

  describe('token request validation', function () {

    it('should trigger an error if state is missing', function (done) {
      supertest(app)
        .post('/fxa-oauth/token')
        .send({ code: '1' })
        .expect(400)
        .end(done);
    });

    it('should trigger an error if code is missing', function (done) {
      supertest(app)
        .post('/fxa-oauth/token')
        .send({ state: '1' })
        .expect(400)
        .end(done);
    });

    it('should trigger an error if all params are missing', function (done) {
      supertest(app)
        .post('/fxa-oauth/token')
        .expect(400)
        .end(done);
    });

    it('should trigger state error mismatch', function (done) {
      supertest(app)
        .post('/fxa-oauth/params')
        .expect(200)
        .end(function (err, res) {
          supertest(app).post('/fxa-oauth/token')
            .send({ state: '1', code: '1' })
            .expect(400)
            .end(done);
        });
    });
  });

  describe('redirect', function () {
    it('should trigger redirect', function (done) {
      supertest(app)
        .get('/fxa-oauth/redirect')
        .expect(302)
        .end(done);
    });
  });
});
