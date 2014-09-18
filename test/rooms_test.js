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
var expectFormatedError = require("./support").expectFormatedError;
var errors = require("../loop/errno.json");

var loop = require("../loop");
var app = loop.app;
var validators = loop.validators;
var apiRouter = loop.apiRouter;
var conf = loop.conf;


describe("/rooms", function() {
  describe("validators", function() {
    apiRouter.post('/validate-room-url', validators.validateRoomUrlParams, function(req, res) {
      res.status(200).json(req.roomUrlData);
    });

    var validateRoomReq;

    beforeEach(function() {
      validateRoomReq = supertest(app)
        .post('/validate-room-url')
        .type('json');
    });

    it("should not fail if all parameters validate", function(done) {
      validateRoomReq.send({
        roomName: "UX Discussion",
        expiresIn: "5",
        roomOwner: "Alexis",
        maxSize: "2"
      })
      .expect(200)
      .end(done);
    });

    it("should use default value if expiresIn parameter is missing",
      function(done) {
        validateRoomReq.send({
          roomName: "UX Discussion",
          roomOwner: "Alexis",
          maxSize: "2"
        })
        .expect(200)
        .end(function(err, res) {
          if (err) throw err;
          expect(res.body.expiresIn).to.eql(conf.get('rooms').defaultTTL);
          done();
        });
      });

    it("should fail in case roomName parameter is missing", function(done) {
      validateRoomReq.send({
        roomOwner: "Alexis",
        maxSize: "2"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                            "Missing: roomName");
        done();
      });
    });

    it("should fail in case roomOwner parameter is missing", function(done) {
      validateRoomReq.send({
        roomName: "UX Discussion",
        maxSize: "2"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                            "Missing: roomOwner");
        done();
      });
    });

    it("should fail in case maxSize parameter is missing", function(done) {
      validateRoomReq.send({
        roomOwner: "Alexis",
        roomName: "UX Discussion"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.MISSING_PARAMETERS,
                            "Missing: maxSize");
        done();
      });
    });

    it("should fail if roomName exceeds maxRoomNameSize chars", function(done) {
      validateRoomReq.send({
        roomOwner: "Alexis",
        roomName: "This is too long for loop",
        maxSize: "3"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
          "roomName should be shorter than 15 characters");
        done();
      });
    });

    it("should fail if roomOwner exceeds 100 chars", function(done) {
      validateRoomReq.send({
        roomOwner: "Alexis has a name that's too long",
        roomName: "UX discussion",
        maxSize: "3"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
          "roomOwner should be shorter than 10 characters");
        done();
      });
    });

    it("should fail if expiresIn exceeds the server max value",
      function(done) {
        validateRoomReq.send({
          roomOwner: "Alexis",
          roomName: "UX discussion",
          maxSize: "3",
          expiresIn: "11"
        })
        .expect(400)
        .end(function(err, res) {
          if (err) throw err;
          expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
            "expiresIn cannot be greater than 10");
          done();
        });
      });

    it("should fail if maxSize exceeds the server max value", function(done) {
      validateRoomReq.send({
        roomOwner: "Alexis",
        roomName: "UX discussion",
        maxSize: "4",
        expiresIn: "10"
      })
      .expect(400)
      .end(function(err, res) {
        if (err) throw err;
        expectFormatedError(res, 400, errors.INVALID_PARAMETERS,
          "maxSize cannot be greater than 3");
        done();
      });
    });

  });

  describe("POST for room creation", function() {

    it("should create a new room", function(done) {

    });

    it("should error-out if the ")
  });
});
