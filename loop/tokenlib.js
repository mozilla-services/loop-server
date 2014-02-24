var crypto = require("crypto");
var base64 = require('urlsafe-base64');

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
    // keep the last 32 bits only, so we avoid huge signatures
    signature = signature.slice(signature.length - 4);

    return base64.encode(Buffer.concat([payload,signature]));
  },

  decode: function(token, secret) {
    if (!secret)
      throw new Error("It requires a secret");

    token = base64.decode(token);
    // Split token into <payload><signature: 32 bits>
    var signature = token.slice(token.length - 4).toString();
    var payload = token.slice(0, token.length - 4).toString();

    var hmac = crypto.createHmac("sha256", secret);
    hmac.write(payload);
    hmac.end();

    var sig = hmac.read();
    // The signature is always the last 32 bits only
    sig = sig.slice(sig.length - 4).toString();

    if (sig !== signature)
      throw new Error("Invalid signature");

    return JSON.parse(payload);
  }
};


module.exports = tokenlib;
