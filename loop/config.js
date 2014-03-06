"use strict";
var convict = require('convict');
var format = require('util').format;

/**
 * Validates the keys are present in the configuration object.
 *
 * @param {List} keys  A list of keys that must be present.
 **/
function validateKeys(keys) {
  return function(val) {
    if (!val)
      throw new Error("Should be defined");
    keys.forEach(function(key) {
      if (!val.hasOwnProperty(key))
        throw new Error(format("Should have a %s property", key));
    });
  };
}

function hexKeyOfSize(size) {
  return function check(val) {
    if (val === "")
      return;
    if (!new RegExp('^[a-f0-9]{' + size * 2 + '}$').test(val)){
      throw new Error("Should be an " + size +
                      " bytes key encoded as hexadecimal");
    }
  };
}

var conf = convict({
  env: {
    doc: "The applicaton environment.",
    format: ["production", "development", "test"],
    default: "development",
    env: "NODE_ENV"
  },
  ip: {
    doc: "The IP address to bind.",
    format: "ipaddress",
    default: "127.0.0.1",
    env: "IP_ADDRESS"
  },
  port: {
    doc: "The port to bind.",
    format: "port",
    default: 5000,
    env: "PORT"
  },
  macSecret: {
    doc: "The secret for MAC tokens (32 bytes key encoded as hex)",
    format: hexKeyOfSize(32),
    default: "",
    env: "MAC_SECRET"
  },
  encryptionSecret: {
    doc: "The secret for encrypting tokens (16 bytes key encoded as hex)",
    format: hexKeyOfSize(16),
    default: "",
    env: "ENCRYPTING_SECRET"
  },
  displayVersion: {
    doc: "Display the server version on the homepage.",
    default: true,
    format: Boolean
  },
  urlsStore: {
    doc: "urlsStore config",
    format: validateKeys(["engine", "settings"]),
    default: ""
  },
  callsStore: {
    doc: "callsStore config",
    format: validateKeys(["engine", "settings"]),
    default: ""
  },
  tokBox: {
    doc: "TokBox service config",
    format: validateKeys(["apiKey", "apiSecret", "serverIP"]),
    default: ""
  }
});


var env = conf.get('env');
conf.loadFile('./config/' + env + '.json');

conf.validate();

if (conf.get('macSecret') === "")
  throw "Please define macSecret in your configuration file";

if (conf.get('encryptionSecret') === "")
  throw "Please define encryptionSecret in your configuration file";

module.exports = conf;
