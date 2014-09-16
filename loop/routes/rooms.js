/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

var errors = require('../errno.json');
var sendError = require('../utils').sendError;

/* eslint-disable */

module.exports = function (apiRouter, conf, logError, storage, auth,
                           validators, tokBox) {

  function validateRoomUrlParams(req, res, next) {
    var expiresIn = conf.get('rooms').urlTimeout,
        maxTimeout = conf.get('rooms').maxTimeout,
        serverMaxSize = conf.get('rooms').maxSize,
        maxSize;

    if (req.body.hasOwnProperty("roomName")) {
      if (req.body.roomName.length > 100) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "roomName should be shorter than 100 characters");
        return;
      }
    }
    if (req.body.hasOwnProperty("roomOwner")) {
      if (req.body.roomOwner.length > 100) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "roomOwner should be shorter than 100 characters");
        return;
      }
    }

    if (req.body.hasOwnProperty("expiresIn")) {
      expiresIn = parseInt(req.body.expiresIn, 10);

      if (isNaN(expiresIn)) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "expiresIn should be a valid number");
        return;
      } else if (expiresIn > maxTimeout) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "expiresIn should be less than " + maxTimeout);
        return;
      }
    }

    if(req.body.hasOwnProperty("maxSize")) {
      maxSize = parseInt(req.body.maxSize);

      if (maxSize > serverMaxSize) {
        sendError(res, 400, errors.INVALID_PARAMETERS,
                  "rooms maxSize cannot be greater than " + serverMaxSize);
      }
    }

    req.roomUrlData = {
      roomName: req.body.roomName,
      expiresIn: expiresIn,
      roomOwner: req.body.roomOwner,
      maxSize: req.body.maxSize,
    };

    next();
  }


  /**
   * Room creation.
   *
   * accepts
   *   roomName - The room-owner-assigned name used to identify this room.
   *   expiresIn - The number of hours for which the room will exist.
   *   roomOwner - The user-friendly display name indicating the name of the room's owner.
   *   maxSize - The maximum number of users allowed in the room at one time.

   * returns
   *   roomToken - The token used to identify this room.
   *   roomUrl - A URL that can be given to other users to allow them to join the room.
   *   expiresAt - The date after which the room will no longer be valid (in seconds since the Unix epoch).
   *
   **/
  apiRouter.post('/rooms', validateRoomUrlParams, function(req, res) {

    res.status(200).json({
      roomToken: token,
      roomUrl: roomUrl,
      expiresAt: expiresAt
    });

  });

  /**
   * PUT /rooms/{id}
   *
   * accepts:
   * roomName - The room-owner-assigned name used to identify this room.
   * expiresIn - The number of hours for which the room will exist.
   * roomOwner - The user-friendly display name indicating the name of the
                 room's owner.
   * maxSize - The maximum number of users allowed in the room at one time.
   *
   * returns
   * expiresAt - The date after which the room will no longer be valid (in
   * seconds since the Unix epoch).
   **/
  apiRouter.put('/rooms/:id', function(req, res) {

  });

  apiRouter.delete('/rooms/:id', function(req, res) {

  });

  apiRouter.get('/rooms/:id', function(req, res) {

  });

  /**
   * action - "join", "leave", "refresh".
   *
   * For join, accepts:
   * displayName - User-friendly display name for the joining user.
   * clientMaxSize - Maximum number of room participants the user's client is capable of supporting.
   **/
  apiRouter.post('/rooms/:id', function(req, res) {

  });

  /**
   * returns:
   *
   * roomToken - The token that uniquely identifies this room
   * roomName - The room-owner-assigned name used to identify this room
   * maxSize - The maximum number of users allowed in the room at one time
   *           (as configured by the room owner).
   * clientMaxSize - The current maximum number of users allowed in the room,
   *                 as constrained by the clients currently participating in
   *                 the session. If no client has a supported size smaller
   *                 than "maxSize", then this will be equal to "maxSize".
   *                 Under no circumstances can "clientMaxSize" be larger than
   *                 "maxSize".
   * currSize - The number of users currently in the room
   * ctime - Similar in spirit to the Unix filesystem "ctime" (change time)
   *         attribute. The time, in seconds since the Unix epoch, that any
   *         of the following happened to the room:
   * - The room was created
   * - The owner modified its attributes with "PUT /room-url/{token}"
   * - A user joined the room
   * - A user left the room
  **/

  apiRouter.get('/rooms', function(req, res) {

  });
};
/* eslint-enable */
