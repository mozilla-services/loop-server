/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

var crypto = require('crypto'),
  request = require('request'),
  sessions = require('client-sessions');

module.exports = function (conf, logError) {

  var oauthConf = conf.get('fxaOauth');

  /**
   * This is just a basic session, used as a demo.
   *
   * @param req
   * @param res
   * @param next
   * @returns {*|exports}
   */
  var stateSession = function (req, res, next) {
    return sessions({
      cookieName: 'fxaOauth',
      secret: conf.get('sessionSecret'),
      requestKey: 'session',
      cookie: {
        path: '/fxa-oauth',
        httpOnly: true
      }
    })(req, res, next);
  };

  var routes = function (app) {
    /**
     * Returns a set of parameters, this is used by Firefox WebChannel
     */
    app.post('/fxa-oauth/params', stateSession, function (req, res) {
      var oauthParams = {
        state: req.session.state || crypto.randomBytes(32).toString('hex'),
        client_id: oauthConf.client_id,
        oauth_uri: oauthConf.oauth_uri,
        profile_uri: oauthConf.profile_uri,
        content_uri: oauthConf.content_uri,
        scope: oauthConf.scopes,
        action: 'signin'
      };

      req.session.state = oauthParams.state;

      return res.json(oauthParams);
    });

    /**
     * Confirms
     */
    app.post('/fxa-oauth/token', stateSession, function (req, res) {
      var code = req.body.code;
      var state = req.body.state;

      if (!code || !state) {
        logError(new Error('Bad Payload.'));
        return res.json(400, 'Bad State');
      }

      if (state !== req.session.state) {
        logError(new Error('State Mismatch'));
        return res.json(400, 'State Mismatch');
      }

      request.post({
        uri: oauthConf.oauth_uri + '/token',
        json: {
          code: code,
          client_id: oauthConf.client_id,
          client_secret: oauthConf.client_secret
        }
      }, function (err, r, body) {
        if (err) {
          logError(err);
          return res.json(503, 'Service unavailable');
        }

        var tokenData = {
          token_type: body.token_type,
          access_token: body.access_token,
          scopes: body.scopes
        };

        return res.json(tokenData);
      });
    });

    // TODO: this will only be used when the user opens an email
    // TODO: and confirms the account in a different browser
    // verifying their Firefox Account.
    // Find a proper route to redirect them to.
    app.get('/fxa-oauth/redirect', function (req, res) {
      return res.redirect('/fxa-oauth');
    });

    /**
     * Login to Loop Server using fxa-oauth.html
     */
    var DIFFERENT_BROWSER_ERROR = 3005;
    // oauth flows are stored in memory
    var oauthFlows = { };

    // construct a redirect URL
    function redirectUrl(action, nonce) {

      return oauthConf.oauth_uri + '/authorization' +
        "?client_id=" + oauthConf.client_id +
        "&redirect_uri=" + oauthConf.redirect_uri +
        "&state=" + nonce +
        "&scope=" + oauthConf.scopes +
        "&action=" + action;
    }

    /**
     * This just sends the static DEMO login page
     */
    app.get('/fxa-oauth', function (req, res) {
      return res.sendfile('fxa-oauth.html');
    });

    // auth status reports who the currently logged in user is on this
    // session
    app.get('/fxa-oauth/auth_status', stateSession, function (req, res) {
      res.send(JSON.stringify({
        email: req.session.email || null,
      }));
    });

    // begin a new oauth log in flow
    app.get('/fxa-oauth/login', stateSession, function (req, res) {
      var nonce = crypto.randomBytes(32).toString('hex');
      oauthFlows[nonce] = true;
      req.session.state = nonce;
      var url = redirectUrl("signin", nonce);
      return res.redirect(url);
    });


    // begin a new oauth sign up flow
    app.get('/fxa-oauth/signup', stateSession, function (req, res) {
      var nonce = crypto.randomBytes(32).toString('hex');
      oauthFlows[nonce] = true;
      req.session.state = nonce;
      var url = redirectUrl("signup", nonce);
      return res.redirect(url);
    });


    // logout clears the current authenticated user
    app.post('/fxa-oauth/logout', stateSession, function (req, res) {
      req.session.reset();
      res.send(200);
    });

    app.get('/fxa-oauth/oauth', stateSession, function (req, res) {
      var state = req.query.state;
      var code = req.query.code;
      var error = parseInt(req.query.error, 10);

      // The user finished the flow in a different browser.
      // Prompt them to log in again
      if (error === DIFFERENT_BROWSER_ERROR) {
        return res.redirect('/?oauth_incomplete=true');
      }

      // state should exists in our set of active flows and the user should
      // have a cookie with that state
      if (code && state && state in oauthFlows && state === req.session.state) {
        delete oauthFlows[state];
        delete req.session.state;

        request.post({
          uri: oauthConf.oauth_uri + '/token',
          json: {
            code: code,
            client_id: oauthConf.client_id,
            client_secret: oauthConf.client_secret
          }
        }, function (err, r, body) {
          if (err) return res.send(r.status, err);

          console.log(err, body);
          req.session.scopes = body.scopes;
          req.session.token_type = body.token_type;
          var token = req.session.token = body.access_token;

          // store the bearer token
          //db.set(code, body.access_token);

          request.get({
            uri: oauthConf.profile_uri + '/profile',
            headers: {
              Authorization: 'Bearer ' + token
            }
          }, function (err, r, body) {
            console.log(err, body);
            if (err || r.status >= 400) {
              return res.send(r ? r.status : 400, err || body);
            }
            var data = JSON.parse(body);
            req.session.email = data.email;
            req.session.uid = data.uid;
            res.redirect('/fxa-oauth');
          });
        });
      } else if (req.session.email) {
        // already logged in
        res.redirect('/fxa-oauth');
      } else {

        var msg = 'Bad request ';
        if (!code) msg += ' - missing code';

        if (!state) {
          msg += ' - missing state';
        } else if (!oauthFlows[state]) {
          msg += ' - unknown state';
        } else if (state !== req.session.state) {
          msg += ' - state cookie doesn\'t match';
        }

        console.error('msg', msg);

        res.send(400, msg);
      }
    });

  };

  return {
    routes: routes,
    request: request
  };
};
