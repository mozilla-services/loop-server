/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var async = require('async');
var randomBytes = require("crypto").randomBytes;
var decrypt = require("../encrypt").decrypt;
var errors = require('../errno.json');
var hmac = require('../hmac');
var getProgressURL = require('../utils').getProgressURL;
var request = require('request');
var sendError = require('../utils').sendError;
var phone = require('phone');
var constants = require("../constants");

module.exports = function(app, conf, logError, storage, tokBox, auth,
  validators) {
  var progressURL = getProgressURL(conf.get('publicServerAddress'));

  /**
   * Helper to store and trigger an user initiated call.
   *
   * options is a javascript object which can have the following keys:
   * - callerId: the identifier for the caller;
   * - callType: the type of the call;
   * - calleeFriendlyName: the friendly name of the person called;
   * - callToken: the call token that was used to initiate the call (if any;
   * - urlCreationDate: the timestamp of the url used to make the call;
   */
  function storeUserCallTokens(options, callback) {
    tokBox.getSessionTokens({
      channel: options.channel
    }, function(err, tokboxInfo) {
      if (err) {
        callback(err);
        return;
      }

      var currentTimestamp = Date.now();
      var callId = randomBytes(16).toString('hex');

      var wsCalleeToken = randomBytes(16).toString('hex');
      var wsCallerToken = randomBytes(16).toString('hex');

      var callInfo = {
        'callId': callId,
        'callType': options.callType,
        'callState': constants.CALL_STATES.INIT,
        'timestamp': currentTimestamp,

        'callerId': options.callerId,
        'calleeFriendlyName': options.calleeFriendlyName,

        'apiKey': tokboxInfo.apiKey,
        'sessionId': tokboxInfo.sessionId,
        'calleeToken': tokboxInfo.calleeToken,
        'callerToken': tokboxInfo.callerToken,

        'wsCallerToken': wsCallerToken,
        'wsCalleeToken': wsCalleeToken,

        'callToken': options.callToken,
        'urlCreationDate': options.urlCreationDate
      };
      callback(null, callInfo);
    });
  }

  /**
   * List all the pending calls for the authenticated user.
   **/
  app.get('/calls', auth.requireHawkSession, function(req, res) {
      if (!req.query.hasOwnProperty('version')) {
        sendError(res, 400, errors.MISSING_PARAMETERS,
                  "Missing: version");
        return;
      }

      var version = req.query.version;

      storage.getUserCalls(req.user, function(err, records) {
        if (res.serverError(err)) return;

        var calls = records.filter(function(record) {
          return record.timestamp >= version &&
                 record.callState !== constants.CALL_STATES.TERMINATED;
        }).map(function(record) {
          // XXX Bug 1032966 - call_url is deprecated
          var result = {
            callId: record.callId,
            callType: record.callType,
            callerId: record.callerId,
            websocketToken: record.wsCalleeToken,
            apiKey: record.apiKey,
            sessionId: record.sessionId,
            sessionToken: record.calleeToken,
            progressURL: progressURL
          };
          if (record.callToken !== undefined) {
            result.callUrl = conf.get("webAppUrl")
              .replace("{token}", record.callToken);
            result.call_url = result.callUrl;
            result.callToken = record.callToken;
            result.urlCreationDate = record.urlCreationDate;
          }
          return result;
        });

        res.status(200).json({calls: calls});
      });
    });

  /**
   * Add a call from a registered user to another registered user.
   **/
  app.post('/calls', auth.requireHawkSession,
    validators.requireParams('calleeId'), validators.validateCallType,
    function(req, res) {
      storage.getHawkUserId(req.hawkIdHmac, function(err, encryptedUserId) {
        if (res.serverError(err)) return;

        var userId;
        if (encryptedUserId !== null) {
          userId = decrypt(req.hawk.id, encryptedUserId);
        }

        var calleeId = req.body.calleeId;
        if (!Array.isArray(calleeId)) {
          calleeId = [calleeId];
        }

        // We get all the Loop users that match any of the ids
        // provided by the client. We may have none, one or multiple
        // matches. If no match is found we throw an error, otherwise
        // we will follow the call process, storing the call
        // information and notifying to the correspoding matched
        // users.
        var callees = [];

        storeUserCallTokens({
          callType: req.body.callType,
          channel: req.body.channel,
          callerId: userId,
          progressURL: progressURL
        }, function(err, callInfo) {
          if (res.serverError(err)) return;

          req.callId = callInfo.callId;
          var callerToken = callInfo.callerToken;
          // Don't save the callerToken information in the database.
          delete callInfo.callerToken;

          async.each(calleeId, function(identity, callback) {
            if (typeof identity === 'object') {
              if (identity.hasOwnProperty("phoneNumber")) {
                var phoneNumber = identity.phoneNumber.trim();
                if (!identity.hasOwnProperty("mcc") &&
                    !phoneNumber.match(/^\+/)) {
                  // Ignore objects without a MSISDN phoneNumber or a MCC
                  callback();
                  return;
                }
                var makePhone = phone(phoneNumber, parseInt(identity.mcc, 10) || undefined);
                if (makePhone.length === 2) {
                  // Continue with the MSISDN as identity
                  identity = makePhone[0];
                } else {
                  // Try again without the given MCC
                  makePhone = phone(phoneNumber);
                  if (makePhone.length === 2) {
                    identity = makePhone[0];
                  } else {
                    // Ignore wrong numbers
                    callback();
                    return;
                  }
                }
              } else {
                // Ignore objects without phoneNumber
                callback();
                return;
              }
            }
            var calleeMac = hmac(identity, conf.get('userMacSecret'));
            storage.getUserSimplePushURLs(calleeMac, function(err, simplePushURLsMapping) {
              if (err) {
                callback(err);
                return;
              }
              var urls = simplePushURLsMapping.calls;
              if (urls.length === 0) {
                callback();
                return;
              }
              callees.push(calleeMac);
              storage.addUserCall(calleeMac, callInfo,
                function(err) {
                  if (err) {
                    callback(err);
                    return;
                  }

                  storage.setCallState(
                    callInfo.callId, constants.CALL_STATES.INIT,
                    function() {
                      if (res.serverError(err)) return;

                      urls.forEach(function(simplePushUrl) {
                        request.put({
                          url: simplePushUrl,
                          form: { version: callInfo.timestamp }
                        }, function() {
                          // Catch errors.
                        });
                      });
                      callback();
                    });
                });
            });
          }, function(err) {
            if (res.serverError(err)) return;

            if (callees.length === 0) {
              sendError(res, 400, errors.INVALID_PARAMETERS,
                        "Could not find any existing user to call");
              return;
            }

            res.status(200).json({
              callId: callInfo.callId,
              websocketToken: callInfo.wsCallerToken,
              sessionId: callInfo.sessionId,
              sessionToken: callerToken,
              apiKey: callInfo.apiKey,
              progressURL: progressURL
            });
          });
        });
      });
    });

  /**
   * Return the callee friendly name for the given token.
   **/
  app.get('/calls/:token', validators.validateToken, function(req, res) {
    res.status(200).json({
      calleeFriendlyName: req.callUrlData.issuer,
      urlCreationDate: req.callUrlData.timestamp
    });
  });

  /**
   * Initiate a call with the user identified by the given token.
   **/
  app.post('/calls/:token', validators.validateToken,
    validators.validateCallType, function(req, res) {
      storage.getUserSimplePushURLs(req.callUrlData.userMac,
        function(err, urls) {
          if (res.serverError(err)) return;

          if (!urls) {
            sendError(res, 410, errors.EXPIRED, "Gone");
            return;
          }

          storage.getHawkUserId(req.hawkIdHmac, function(err, encryptedUserId) {
            if (res.serverError(err)) return;

            var userId;
            if (encryptedUserId !== null) {
              userId = decrypt(req.hawkIdHmac, encryptedUserId);
            }

            storeUserCallTokens({
              callType: req.body.callType,
              channel: req.body.channel,
              user: req.callUrlData.userMac,
              callerId: userId || req.callUrlData.callerId,
              calleeFriendlyName: req.callUrlData.issuer,
              callToken: req.token,
              urlCreationDate: req.callUrlData.timestamp
            }, function(err, callInfo) {
              if (res.serverError(err)) return;

              callInfo = JSON.parse(JSON.stringify(callInfo));
              req.callId = callInfo.callId;
              var callerToken = callInfo.callerToken;
              // Don't save the callerToken information in the database.
              delete callInfo.callerToken;

              storage.addUserCall(req.callUrlData.userMac, callInfo,
                function(err) {
                  if (res.serverError(err)) return;

                  storage.setCallState(
                    callInfo.callId, constants.CALL_STATES.INIT,
                    function() {
                      if (res.serverError(err)) return;

                      // Call SimplePush urls.
                      if (!Array.isArray(urls)) {
                        urls = [urls];
                      }

                      urls.forEach(function(simplePushUrl) {
                        request.put({
                          url: simplePushUrl,
                          form: { version: callInfo.timestamp }
                        }, function() {
                          // Catch errors.
                        });
                      });

                      res.status(200).json({
                        callId: callInfo.callId,
                        websocketToken: callInfo.wsCallerToken,
                        sessionId: callInfo.sessionId,
                        sessionToken: callerToken,
                        apiKey: callInfo.apiKey,
                        progressURL: progressURL
                      });
                    });
                });
            });
          });
        });
    });
  return storeUserCallTokens;
};
