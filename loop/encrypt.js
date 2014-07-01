/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var sodium = require("sodium");


/**
 * Take an passphrase and a string and encrypt it as a string
 */
function encrypt(passphrase, text) {
  // Handle null
  if (text === null) {
    return null;
  }
  var box = new sodium.SecretBox(passphrase);
  var encrypted = box.encrypt(text, "utf8");
  var data = {
    cipherText: encrypted.cipherText.toString("base64"),
    nonce: encrypted.nonce.toString("base64")
  };
  return JSON.stringify(data);
}

/**
 * Take an passphrase and an encrypted string and decrypt it
 */
function decrypt(passphrase, encryptedString) {
  // Handle null
  if (encryptedString === null) {
    return null;
  }

  var encrypted = JSON.parse(encryptedString);
  var data = {};
  data.cipherText = new Buffer(encrypted.cipherText, "base64");
  data.nonce = new Buffer(encrypted.nonce, "base64");
  var box = new sodium.SecretBox(passphrase);
  return box.decrypt(data, "utf8");
}

module.exports = {
  encrypt: encrypt,
  decrypt: decrypt
};
