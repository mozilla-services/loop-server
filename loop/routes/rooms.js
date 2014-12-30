/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

var async = require('async');
var HKDF = require('hkdf');
var uuid = require('node-uuid');
var request = require('request');

var decrypt = require('../encrypt').decrypt;
var encrypt = require('../encrypt').encrypt;
var errors = require('../errno.json');
var getUserAccount = require('../utils').getUserAccount;
var sendError = require('../utils').sendError;
var tokenlib = require('../tokenlib');
var time = require('../utils').time;

var hmac = require('../hmac');


module.exports = function (apiRouter, conf, logError, storage, auth,
                           validators, tokBox) {

  var roomsConf = conf.get("rooms");

  /**
   * Returns the maximum number of allowed participants, between a list of
   * participants and the maximum size of a room.
   *
   * @param {Array} participants, the list of participants. Each participant
   *                object should contain a "clientMaxSize" property.
   * @param {Number} roomMaxSize, the maximum size of the room.
   **/
  function getClientMaxSize(participants, roomMaxSize) {
    var clientMaxSize = Math.min.apply(Math, participants.map(
      function(participant) {
        return participant.clientMaxSize;
      }));
    return Math.min(clientMaxSize, roomMaxSize);
  }

  /**
   * Returns if it is possible to join a room, given a list of participants
   * and a room maximum size.
   *
   * Always let a free spot for the owner of the room to join.
   *
   * @param {Array} participants, the list of participants.
   * @param {Number} roomMaxSize, the maximum size of the room.
   * @param {String} roomOwnerHmac, the hmac of the room owner.
   **/
  function canJoinRoom(participants, roomMaxSize, roomOwnerHmac, currentHmac) {
    var maxSize = getClientMaxSize(participants, roomMaxSize);
    var spareSpots = maxSize - participants.length;
    var ownerConnected = participants.some(function(participant){
      return participant.userMac === roomOwnerHmac;
    });

    if (!ownerConnected && currentHmac !== roomOwnerHmac) {
      spareSpots--;
    }

    return spareSpots > 0;
  }


  /**
   * Ping the room Owner simplePush rooms endpoints.
   *
   * @param {String} roomOwnerHmac, the hmac-ed owner,
   * @param {Number} version, the version to pass in the request,
   * @param {Function} callback(err), called when notification is complete.
   **/
  function notifyOwner(roomOwnerHmac, version, callback) {
    storage.getUserSimplePushURLs(roomOwnerHmac,
      function(err, simplePushURLsMapping) {
        if (err) return callback(err);
        simplePushURLsMapping.rooms.forEach(function(simplePushUrl) {
          request.put({
            url: simplePushUrl,
            form: { version: version }
          }, function() {
            // Catch errors.
          });
        });
        callback(null);
      });
  }

  /**
   * Update room data and emit an event if needed so the owner is aware.
   *
   * @param roomToken The roomToken
   * @param roomOwnerHmac The roomOwnerHmac
   * @param callback The action to do next
   **/
  function emitRoomEvent(roomToken, roomOwnerHmac, callback) {
    storage.touchRoomData(roomToken, function(err, version) {
      if (err) return callback(err);
      notifyOwner(roomOwnerHmac, version, callback);
    });
  }

  /**
   * Encrypt an account name with the roomID and a secret known only by
   * the server. This is useful as we don't want to store PII on our databases.
   *
   * @param {String} roomToken, the token of the room
   * @param {String} account the account information to encrypt
   * @param {Function} callback which will receive the encrypted account info.
   **/
  function encryptAccountName(roomToken, account, callback) {
    if (account === undefined) {
      callback();
      return;
    }
    var hkdf = new HKDF('sha256', roomsConf.HKDFSalt, roomToken);
    hkdf.derive('account-name', 32, function(key) {
      callback(encrypt(key.toString('hex'), account));
    });
  }
  /**
   * Decrypts an encrypted account information using the roomID and a
   * secret known only by the server.
   *
   * @param {String} roomToken, the token of the room
   * @param {String} encrypted account information to decrypt.
   * @param {Function} callback which will receive the decrypted account info.
   **/
  function decryptAccountName(roomToken, encryptedAccount, callback) {
    if (encryptedAccount === undefined) {
      callback();
      return;
    }
    var hkdf = new HKDF('sha256', roomsConf.HKDFSalt, roomToken);
    hkdf.derive('account-name', 32, function(key) {
      callback(decrypt(key.toString('hex'), encryptedAccount));
    });
  }

  /**
   * Returns room information given a specific token.
   *
   * @param {String} roomToken, the room token;
   * @param {Object} roomStorageData, containing information from the store;
   * @param {Function} callback which will receive the room information.
   **/
  function getRoomInfo(token, roomStorageData, callback) {
    var clientMaxSize = getClientMaxSize(
      roomStorageData.participants,
      roomStorageData.maxSize
    );

    // Since the participant information is stored encrypted,
    // there is a need to decrypt it using async.map as it is an async
    // operation.
    async.map(roomStorageData.participants,
      function(participant, callback) {
        decryptAccountName(token, participant.account, function(account) {
          participant.account = account;
          callback(null, participant);
        });
      }, function(err, participants) {
        if (err) return callback(err);
        participants = participants.map(function(participant) {
          return {
            roomConnectionId: participant.id,
            displayName: participant.displayName,
            account: participant.account,
            owner: (participant.userMac === roomStorageData.roomOwnerHmac)
          };
        });
        return callback(null, {
          roomUrl: roomsConf.webAppUrl.replace('{token}', token),
          roomName: roomStorageData.roomName,
          roomOwner: roomStorageData.roomOwner,
          maxSize: roomStorageData.maxSize,
          clientMaxSize: clientMaxSize,
          creationTime: roomStorageData.creationTime,
          expiresAt: roomStorageData.expiresAt,
          ctime: roomStorageData.updateTime,
          participants: participants,
          roomToken: token
        });
      });
  }

  /**
   * Create a new room with the given information
   **/
  apiRouter.post('/rooms', auth.requireHawkSession,
    validators.requireParams('roomName', 'roomOwner', 'maxSize'),
    validators.validateRoomParams, function(req, res) {

      var roomData = req.roomRequestData;
      var token = tokenlib.generateToken(roomsConf.tokenSize);
      var now = time();
      roomData.creationTime = now;
      roomData.updateTime = now;
      roomData.expiresAt = now + roomData.expiresIn * tokenlib.ONE_HOUR;
      roomData.roomOwnerHmac = req.user;

      tokBox.getSession(function(err, session, opentok) {
        if (res.serverError(err)) return;

        roomData.sessionId = session.sessionId;
        roomData.apiKey = opentok.apiKey;

        storage.setUserRoomData(req.user, token, roomData, function(err) {
          if (res.serverError(err)) return;
          notifyOwner(req.user, roomData.updateTime, function(err) {
            if (res.serverError(err)) return;
            res.status(201).json({
              roomToken: token,
              roomUrl: roomsConf.webAppUrl.replace('{token}', token),
              expiresAt: roomData.expiresAt
            });
          });
        });
      });
    });

  /**
   * Updates information about a room.
   **/
  apiRouter.patch('/rooms/:token', auth.requireHawkSession,
    validators.validateRoomToken, validators.validateRoomParams,
    validators.isRoomOwner, function(req, res) {
      var now = time();
      var roomData = req.roomStorageData;

      roomData.updateTime = now;

      // Update the roomData object with new data from the request.
      Object.keys(req.roomRequestData).forEach(function(key) {
        if (req.roomRequestData[key] !== undefined) {
          roomData[key] = req.roomRequestData[key];
        }
      });

      roomData.expiresAt = now + roomData.expiresIn * tokenlib.ONE_HOUR;

      storage.setUserRoomData(req.user, req.token, roomData, function(err) {
        if (res.serverError(err)) return;
        notifyOwner(req.user, now, function(err) {
          if (res.serverError(err)) return;
          res.status(200).json({
            expiresAt: roomData.expiresAt
          });
        });
      });
    });

  /**
   * Deletes a room.
   * This only works if you're the owner of this room.
   **/
  apiRouter.delete('/rooms/:token', auth.requireHawkSession,
    validators.validateRoomToken, validators.isRoomOwner,
    function(req, res) {
      storage.deleteRoomData(req.token, function(err) {
        if (res.serverError(err)) return;
        var now = time();
        notifyOwner(req.user, now, function(err) {
          if (res.serverError(err)) return;
          res.status(204).json({});
        });
      });
    });

  /**
   * Retrieves information about a specific room.
   *
   * If performed anonymously, only public information is returned.
   **/
  apiRouter.get('/rooms/:token', validators.validateRoomToken,
    auth.authenticateWithHawkOrToken,
    function(req, res) {
      var participantHmac = req.hawkIdHmac || req.participantTokenHmac;

      if (participantHmac === undefined) {
        var roomToken = req.roomStorageData.roomToken;
        res.status(200).json({
          roomToken: req.roomStorageData.roomToken,
          roomName: req.roomStorageData.roomName,
          roomOwner: req.roomStorageData.roomOwner,
          roomUrl: roomsConf.webAppUrl.replace('{token}', roomToken)
        });
        return;
      }

      validators.isRoomParticipant(req, res, function() {
        getRoomInfo(req.token, req.roomStorageData, function(err, roomData) {
          if (res.serverError(err)) return;
          res.status(200).json(roomData);
        });
      });
    });

  /**
   * Do an action on a room.
   *
   * Actions are "join", "leave", "refresh".
   **/
  apiRouter.post('/rooms/:token', validators.validateRoomToken,
    auth.authenticateWithHawkOrToken, function(req, res) {
      var participantHmac = req.hawkIdHmac || req.participantTokenHmac;
      var roomOwnerHmac = req.roomStorageData.roomOwnerHmac;
      var ROOM_ACTIONS = ["join", "refresh", "leave"];
      var action = req.body.action;
      var code;

      if (ROOM_ACTIONS.indexOf(action) === -1) {
        if (req.body.hasOwnProperty('action')) {
          code = errors.INVALID_PARAMETERS;
        } else {
          code = errors.MISSING_PARAMETERS;
        }
        sendError(res, 400, code,
                  "action should be one of " + ROOM_ACTIONS.join(", "));
        return;
      }

      // If the action is not join, they should be authenticated.
      if (participantHmac === undefined && action !== "join") {
        auth.unauthorized(res, ["Token", "Hawk"]);
        return;
      }

      var handlers = {
        handleJoin: function(req, res) {
          validators.requireParams('displayName', 'clientMaxSize')(
            req, res, function() {
              var requestMaxSize = parseInt(req.body.clientMaxSize, 10);
              if (isNaN(requestMaxSize)) {
                sendError(res, 400, errors.INVALID_PARAMETERS,
                          "clientMaxSize should be a number.");
                return;
              }
              var ttl = roomsConf.participantTTL;
              var role = req.user === roomOwnerHmac ? 'moderator' : 'publisher';
              var sessionToken = tokBox.getSessionToken(
                req.roomStorageData.sessionId,
                role
              );

              function next(err) {
                if (res.serverError(err)) return;
                storage.getRoomParticipants(req.token, function(err,
                  participants) {
                    if (res.serverError(err)) return;
                    var roomMaxSize = req.roomStorageData.maxSize;

                    if (!canJoinRoom(
                          participants, roomMaxSize,
                          req.roomStorageData.roomOwnerHmac,
                          req.user)) {
                      sendError(res, 400, errors.ROOM_FULL, "The room is full.");
                      return;
                    } else if (requestMaxSize <= participants.length) {
                      // You cannot handle the number of actual participants.
                      sendError(res, 400, errors.CLIENT_REACHED_CAPACITY,
                        "Too many participants in the room for you to handle.");
                      return;
                    }

                    getUserAccount(storage, req, function(err, acc) {
                      if (res.serverError(err)) return;
                      encryptAccountName(req.token, acc, function(account) {
                        storage.addRoomParticipant(req.token, participantHmac, {
                          id: uuid.v4(),
                          displayName: req.body.displayName,
                          clientMaxSize: requestMaxSize,
                          userMac: req.user,
                          account: account
                        }, ttl, function(err) {
                          if (res.serverError(err)) return;
                          emitRoomEvent(req.token,
                            req.roomStorageData.roomOwnerHmac, function(err) {
                              if (res.serverError(err)) return;
                              res.status(200).json({
                                apiKey: req.roomStorageData.apiKey,
                                sessionId: req.roomStorageData.sessionId,
                                sessionToken: sessionToken,
                                expires: ttl
                              });
                            });
                        });
                      });
                    });
                });
              }
              if (participantHmac === undefined) {
                participantHmac = hmac(sessionToken, conf.get('userMacSecret'));
                storage.setRoomAccessToken(req.token, participantHmac, ttl, next);
                return;
              }
              next();
            });
        },
        handleRefresh: function(req, res) {
          var ttl = roomsConf.participantTTL;
          storage.touchRoomParticipant(req.token, participantHmac, ttl,
            function(err, success) {
              if (res.serverError(err)) return;
              if (success !== true) {
                sendError(res, 410, errors.EXPIRED, "Participation has expired.");
                return;
              }
              res.status(200).json({
                expires: ttl
              });
            });
        },
        handleLeave: function(req, res) {
          storage.deleteRoomParticipant(req.token, participantHmac,
            function(err) {
              if (res.serverError(err)) return;
              emitRoomEvent(req.token, req.roomStorageData.roomOwnerHmac,
                function(err) {
                  if (res.serverError(err)) return;
                  res.status(204).json();
                });
            });
        }
      };

      if (action === "join") {
        handlers.handleJoin(req, res);
      } else if (action === "refresh") {
        handlers.handleRefresh(req, res);
      } else if (action === "leave") {
        handlers.handleLeave(req, res);
      }
    });

  /**
   * List all the rooms for the connected user.
   **/

  apiRouter.get('/rooms', auth.requireHawkSession, function(req, res) {
    var version = parseInt(req.query.version, 10);
    storage.getUserRooms(req.user, function(err, userRooms) {
      if (res.serverError(err)) return;
      // filter the rooms we don't want.
      var rooms = userRooms.filter(function(room) {
        return !(version && room.updateTime < version);
      });

      async.map(rooms,
        function(room, callback) {
          storage.getRoomParticipants(room.roomToken, function(err, participants) {
            if (err) return callback(err);
            room.participants = participants;
            getRoomInfo(room.roomToken, room, callback);
          });
        },
        function(err, rooms) {
          if (res.serverError(err)) return;

          if (version > 0) {
            // Include deleted rooms only if version is specified
            storage.getUserDeletedRooms(req.user, version,
              function(err, deletedRooms) {
                if (res.serverError(err)) return;
                deletedRooms.forEach(function(deleted) {
                  rooms.push({
                    roomToken: deleted,
                    deleted: true
                  });
                });
                res.status(200).json(rooms);
              });
            return;
          }

          res.status(200).json(rooms);
        }
      );
    });
  });
};
