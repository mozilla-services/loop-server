/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

var randomBytes = require('crypto').randomBytes;
var request = require('request');
var sendError = require('../utils').sendError;
var errors = require('../errno.json');
var hmac = require('../hmac');

module.exports = function (app, conf, logError, storage, auth, validators) {

  var oauthConf = conf.get('fxaOAuth');

  /**
   * Provide the client with the parameters needed for the OAuth dance.
   **/
  app.get('/fxa-oauth/parameters', auth.requireHawkSession,
    function(req, res) {
      var callback = function(state) {
        res.json(200, {
          client_id: oauthConf.client_id,
          redirect_uri: oauthConf.redirect_uri,
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
      res.json(200, {
        oauthToken: token
      });
    });
  });

  /**
   * Trade an OAuth code with an oauth bearer token.
   **/
  app.post('/fxa-oauth/token', auth.requireHawkSession,
    validators.requireParams('state', 'code'), function (req, res) {
      var state = req.query.state;
      var code = req.query.code;

      // State should match an existing state.
      storage.getHawkOAuthState(req.hawkIdHmac, function(err, storedState) {
        if (res.serverError(err)) return;
        if (storedState !== state) {
          // Reset session state after an attempt was made to compare it.
          storage.clearHawkOAuthState(req.hawkIdHmac, function(err) {
            if (res.serverError(err)) return;
            sendError(res, 400, errors.INVALID_OAUTH_STATE);
          });
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
              if (res.serverError(err)) return;
            }
            // Store the appropriate profile information into the database,
            // associated with the hawk session.
            var userHmac = hmac(data.email, conf.get('userMacSecret'));
            storage.setHawkUser(userHmac, req.hawkIdHmac, function(err) {
              if (res.serverError(err)) return;
              res.json(200, {
                oauthToken: token
              });
            });
          });
        });
      });
    });
};
