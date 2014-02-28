var convict = require('convict');

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
  tokenSecret: {
    doc: "The secret for generating tokens.",
    format: "*",
    default: "",
    env: "TOKEN_SECRET"
  },
});


var env = conf.get('env');
conf.loadFile('./config/' + env + '.json');

conf.validate();

if (conf.get('tokenSecret') === "")
  throw "Please define tokenSecret in your configuration file";

module.exports = conf;
