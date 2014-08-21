/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

var randomBytes = require('crypto').randomBytes;
var request = require('request');
var sendError = require('../utils').sendError;
var errors = require('../errno.json');
var hmac = require('./hmac');

module.exports = function (app, conf, logError, storage, auth, validators) {

  var oauthConf = conf.get('fxaOauth');

  /**
   * An endpoint you can use to retrieve a hawk session.
   *
   * In the case of OAuth, this session will be upgraded at the end of the
   * authentication flow, with an attached identity.
   **/
  app.post('/session', auth.attachOrCreateHawkSession, function(req, res) {
    res.json(200, 'ok');
  });

  /**
   * Provide the client with the parameters needed for the OAuth dance.
   **/
  app.get('/fxa-oauth/parameters', auth.requireHawkSession, 
    function(req, res) {
      var callback = function(state) {
        res.json(200, {
          client_id: oauthConf.client_id,
          redirect_uri: undefined,
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
  app.get('/fxa-oauth/auth_status', auth.requireHawkSession,
    function (req, res) { 
      // Here return the current logged-in user in the JSON body.
  });

  /**
   * Trade an OAuth code with an oauth bearer token.
   **/
  app.get('/fxa-oauth/oauth', auth.requireHawkSession,
    validators.requireParams('state', 'code'), function (req, res) {
      var state = req.query.state;
      var code = req.query.code;

      // state should match an existing state.
      storage.getHawkOAuthState(req.hawkIdHmac, function(err, storedState) {
        if (storedState !== state) {
          sendError(res, 400, errors.INVALID_OAUTH_STATE);
        }

        // Now, trade the OAuth code for a token.
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
            var data = JSON.parse(body);
            // Store the appropriate profile information into the database,
            // associated with the hawk session.
            var userHmac = hmac(data.email, conf.get('userMacSecret'));
            storage.setHawkUser(userHmac, req.hawkIdHmac, function(err) {
              if (res.serverError(err)) return;
              res.json(200, 'ok');
            });
          });
        });
      });
    }); 
};
