/* global it, describe */

var expect = require("chai").expect;
var tokenlib = require("../loop/tokenlib");

var SECRET = "this is not a secret";

describe("tokenlib", function() {
  "use strict";

  describe("#encode", function() {
    it("should return a token string", function() {
      var token = tokenlib.encode({some: "data"}, SECRET);
      expect(token.constructor.name).to.be.equal("String");
    });

    it("should return an hexadecimal value", function() {
      var token = tokenlib.encode({some: "data"}, SECRET);
      expect(token).to.match(/[0-9A-F]/);
    });

    it("should throw an error if no secret has been provided", function() {
      var noSecret;
      var failure = tokenlib.encode.bind(tokenlib, {}, noSecret);
      expect(failure).to.Throw(/It requires a secret/);
    });
  });

  describe("#decode", function() {
    it("should decode a valid encoded token", function() {
      var data = {some: "data"};
      var token = tokenlib.encode(data, SECRET);
      expect(tokenlib.decode(token, SECRET)).to.deep.equal(data);
    });

    it("should trhow an error if the signature is invalid", function() {
      var data = {some: "data"};
      var token = tokenlib.encode(data, "h4x0r");
      var failure = tokenlib.decode.bind(tokenlib, token, SECRET);
      expect(failure).to.Throw(/Invalid signature/);
    });

    it("should throw an error if no secret has been provided", function() {
      var noSecret;
      var token = tokenlib.encode({some: "data"}, SECRET);
      var failure = tokenlib.decode.bind(tokenlib, token, noSecret);
      expect(failure).to.Throw(/It requires a secret/);
    });
  });

});
