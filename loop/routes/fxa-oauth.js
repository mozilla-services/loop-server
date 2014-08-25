/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

var randomBytes = require('crypto').randomBytes;
var request = require('request');
var sendError = require('../utils').sendError;
var errors = require('../errno.json');
var hmac = require('../hmac');

module.exports = function (app, conf, logError, storage, auth) {

  var oauthConf = conf.get('fxaOAuth');

  /**
   * Provide the client with the parameters needed for the OAuth dance.
   **/
  app.post('/fxa-oauth/params', auth.requireHawkSession,
    function(req, res) {
      var callback = function(state) {
        res.status(200).json({
          client_id: oauthConf.client_id,
          redirect_uri: oauthConf.redirect_uri,
          content_uri: oauthConf.content_uri,
          oauth_uri: oauthConf.oauth_uri,
          scope: oauthConf.scope,
          state: state
        });
      };
      storage.getHawkOAuthState(req.hawkIdHmac, function(err, state) {
        if (res.serverError(err)) return;
        if (state === null) {
          state = randomBytes(32).toString('hex');
          storage.setHawkOAuthState(req.hawkIdHmac, state, function(err) {
            if (res.serverError(err)) return;
            callback(state);
          });
        } else {
          callback(state);
        }
      });
    });

  /**
   * Returns the current status of the hawk session (e.g. if it's authenticated
   * or not.
   **/
  app.get('/fxa-oauth/token', auth.requireHawkSession, function (req, res) {
    storage.getHawkOAuthToken(req.hawkIdHmac, function(err, token) {
      if (res.serverError(err)) return;
      res.status(200).json({
        access_token: token || undefined
      });
    });
  });

  /**
   * Trade an OAuth code with an oauth bearer token.
   **/
  app.post('/fxa-oauth/token', auth.requireHawkSession, function (req, res) {
      var state = req.body.state;
      var code = req.body.code;

      var missingParams = [];
      if (!state) {
        missingParams.push('state');
      }
      if (!code) {
        missingParams.push('code');
      }
      if (missingParams.length > 0) {
        sendError(res, 400, errors.MISSING_PARAMETERS,
                  "Missing: " + missingParams.join(", "));
        return;
      }

      // State should match an existing state.
      storage.getHawkOAuthState(req.hawkIdHmac, function(err, storedState) {
        if (res.serverError(err)) return;

        storage.clearHawkOAuthState(req.hawkIdHmac, function(err) {
          if (res.serverError(err)) return;
        });

        if (storedState !== state) {
          // Reset session state after an attempt was made to compare it.
          sendError(res, 400,
            errors.INVALID_OAUTH_STATE, "Invalid OAuth state");
          return;
        }

        // Trade the OAuth code for a token.
        request.post({
          uri: oauthConf.oauth_uri + '/token',
          json: {
            code: code,
            client_id: oauthConf.client_id,
            client_secret: oauthConf.client_secret
          }
        }, function (err, r, body) {
          if (res.serverError(err)) return;

          var token = body.access_token;
          var tokenType = body.token_type;
          var scope = body.scope;

          // store the bearer token
          storage.setHawkOAuthToken(req.hawkIdHmac, token);

          // Make a request to the FxA server to have information about the
          // profile.
          request.get({
            uri: oauthConf.profile_uri + '/profile',
            headers: {
              Authorization: 'Bearer ' + token
            }
          }, function (err, r, body) {
            if (res.serverError(err)) return;
            var data;
            try {
              data = JSON.parse(body);
            } catch (e) {
              if (res.serverError(new Error(e + " JSON: " + body))) return;
            }
            // Store the appropriate profile information into the database,
            // associated with the hawk session.
            var userHmac = hmac(data.email, conf.get('userMacSecret'));
            storage.setHawkUser(userHmac, req.hawkIdHmac, function(err) {
              if (res.serverError(err)) return;
              res.status(200).json({
                token_type: tokenType,
                access_token: token,
                scope: scope
              });
            });
          });
        });
      });
    });
};
