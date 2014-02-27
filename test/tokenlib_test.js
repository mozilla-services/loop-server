/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var expect = require("chai").expect;
var base64 = require('urlsafe-base64');
var tokenlib = require("../loop/tokenlib");


describe("TokenManager", function() {
  "use strict";

  var SECRET = "this is not a secret";
  var tokenManager = new tokenlib.TokenManager(SECRET);

  describe("constructor", function() {

    it("should throw an error if no secret has been provided", function() {
      var noSecret;
      var failure = function() {
        return tokenlib.TokenManager(noSecret);
      };
      expect(failure).to.Throw(/TokenManager requires a 'secret' argument/);
    });

  });

  describe("#encode", function() {
    it("should return a token string", function() {
      var token = tokenManager.encode({some: "data"});
      expect(token.constructor.name).to.be.equal("String");
    });

    it("should return an base64 url safe value", function() {
      var token = tokenManager.encode({some: "data"});
      expect(base64.validate(token)).to.equal(true);
    });
  });

  describe("#decode", function() {
    it("should decode a valid encoded token", function() {
      var data = {some: "data"};
      var token = tokenManager.encode(data);
      expect(tokenManager.decode(token)).to.deep.equal(data);
    });

    it("should trhow an error if the signature is invalid", function() {
      var data = {some: "data"};
      var tokenForger = new tokenlib.TokenManager("h4x0r");
      var token = tokenForger.encode(data);
      var failure = function() {
        tokenManager.decode(token);
      };
      expect(failure).to.Throw(/Invalid signature/);
    });
  });

});
