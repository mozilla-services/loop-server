/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
var getStorage = require("./index");

var DEFAULT_METHODS = {
  volatileStorage: [
    "addUserCall",
    "deleteUserCalls",
    "getUserCalls",
    "getCallStateTTL",
    "setCallState",
    "getCallState",
    "setCallTerminationReason",
    "getCallTerminationReason",
    "getCall",
    "deleteCall",
    "setHawkOAuthState",
    "getHawkOAuthState",
    "clearHawkOAuthState",
    // These below still need to be implemented in MySQL.
    "setHawkOAuthToken",
    "getHawkOAuthToken"
  ],

  persistentStorage: [
    "addUserSimplePushURLs",
    "getUserSimplePushURLs",
    "removeSimplePushURLs",
    "deleteUserSimplePushURLs",
    "addUserCallUrlData",
    "updateUserCallUrlData",
    "getCallUrlData",
    "deleteUserCallUrls",
    "revokeURLToken",
    "getUserCallUrls",
    "setHawkUser",
    "getHawkUser",
    "setHawkUserId",
    "getHawkUserId",
    "setHawkSession",
    "touchHawkSession",
    "getHawkSession",
    "deleteHawkSession",
    "setUserRoomData",
    "getUserRooms",
    "getRoomData",
    "touchRoomData",
    "deleteRoomData",
    "deleteRoomParticipants",
    "addRoomParticipant",
    "touchRoomParticipant",
    "deleteRoomParticipant",
    "getRoomParticipants"
  ],

  proxy: ["drop", "ping"]
}

/**
 * A proxy implementation of the storage, which exposes the same functions as
 * the storages, but routes them to either the volatile storage (redis) or the
 * persistent storage (MySQL).
 *
 * It is able to proxy three types of methods:
 * - the **volatile** methods, which deal with data that's volatile and that we
 *   can lose (stored in redis initially);
 * - the **persistent** methods, which deal with data that should be stored for
 *   an undefined amount of time;
 * - the **proxied** methods, which will rely to the two backends and return
 *   any error that arised.
 *
 **/
function StorageProxy(conf, options, methods) {
  if (methods === undefined){
    methods = DEFAULT_METHODS;
  }
  var volatileStorage = getStorage(conf.volatileStorage, options);
  var persistentStorage = getStorage(conf.persistentStorage, options);

  var self = this;

  /**
   * Bind the given methods of the given storage.
   **/
  function setupMethods(name, storage, methods) {
    methods.forEach(function(method) {
      if (typeof storage[method] !== "function") {
        var type = storage.constructor.name;
        throw new Error(type + " need a " + method +
                        " to be used as " + name + " storage.");
      }
      self[method] = storage[method].bind(storage);
    });
  }

  /**
   * Set the proxy methods on the current function prototype.
   *
   * The proxy methods **cannot** return data, and should either return
   * an error or nothing.
   **/
  function setProxyMethods(_volatileStorage, _persistentStorage, methods) {

    methods.forEach(function(method) {
      var type;
      if (typeof _volatileStorage[method] !== "function") {
        type = _volatileStorage.constructor.name;
        throw new Error(type + " need a " + method +
                        " to be used as volatile storage.");
      }
      if (typeof _persistentStorage[method] !== "function") {
        type = _persistentStorage.constructor.name;
        throw new Error(type + " need a " + method +
                        " to be used as volatile storage.");
      }
      self[method] = function() {
        // get the callback out of the arguments.
        var args = Array.prototype.slice.call(arguments);
        var callback = args.pop();
        // call the method on the volatile storage.
        _volatileStorage[method].apply(_volatileStorage, args.concat([
          function() {
            // And on the callback of the volatile storage, call the persistent
            // storage method with the callback we have stored.

            var cbArgs = Array.prototype.slice.call(arguments);
            // If we have an error, call the callback with it.
            if (cbArgs[0]) {
              callback(cbArgs[0]);
              return;
            }
            _persistentStorage[method].apply(
              _persistentStorage, args.concat(callback));
          }
        ]));
      };
    });
  }

  setupMethods("volatile", volatileStorage, methods.volatileStorage);
  setupMethods("persistent", persistentStorage, methods.persistentStorage);
  setProxyMethods(volatileStorage, persistentStorage, methods.proxy);
}

module.exports = StorageProxy;
