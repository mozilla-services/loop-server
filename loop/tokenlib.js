var crypto = require("crypto");

var tokenlib = {
  encode: function(data, secret) {
    if (!secret)
      throw new Error("It requires a secret");

    var payload, signature, hmac;

    payload = new Buffer(JSON.stringify(data));

    hmac = crypto.createHmac("sha256", secret);
    hmac.write(payload);
    hmac.end();

    signature = hmac.read();
    signature = signature.slice(signature.length - 32);

    return Buffer.concat([payload,signature]).toString("hex");
  },

  decode: function(token, secret) {
    if (!secret)
      throw new Error("It requires a secret");

    token = new Buffer(token, "hex");
    var signature = token.slice(token.length - 32).toString();
    var payload = token.slice(0, token.length - 32).toString();

    var hmac = crypto.createHmac("sha256", secret);
    hmac.write(payload);
    hmac.end();

    var sig = hmac.read();
    sig = sig.slice(sig.length - 32).toString();

    if (sig !== signature)
      throw new Error("Invalid signature");

    return JSON.parse(payload);
  }
};


module.exports = tokenlib;
