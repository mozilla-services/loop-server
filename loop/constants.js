/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

module.exports = {
  CALL_STATES: {
    INIT: "init",
    HALF_INITIATED: "half-initiated",
    ALERTING: "alerting",
    CONNECTING: "connecting",
    HALF_CONNECTED: "half-connected",
    CONNECTED: "connected",
    TERMINATED: "terminated"
  },
  ROOM_STATES: {
    INIT: "init",
    WAITING: "waiting",
    STARTING: "starting",
    SENDING: "sending",
    SEND_RECV: "sendrecv",
    RECEIVING: "receiving",
    CLEANUP: "cleanup"
  },
  ROOM_EVENTS: {
    SESSION_CONNECTION_CREATED: "Session.connectionCreated",
    SESSION_CONNECTION_DESTROYED: "Session.connectionDestroyed",
    SESSION_STREAM_CREATED: "Session.streamCreated",
    SESSION_STREAM_DESTROYED: "Session.streamDestroyed",
    PUBLISHER_STREAM_CREATED: "Publisher.streamCreated",
    PUBLISHER_STREAM_DESTROYED: "Publisher.streamDestroyed"
  },
  MESSAGE_EVENTS: {
    ACCEPT: "accept",
    MEDIA_UP: "media-up",
    TERMINATE: "terminate"
  },
  MESSAGE_TYPES: {
    HELLO: "hello",
    ACTION: "action",
    PROGRESS: "progress",
    ECHO: "echo",
    ERROR: "error"
  },
  MESSAGE_REASONS: {
    BUSY: "busy",
    CANCEL: "cancel",
    TIMEOUT: "timeout",
    CLOSED: "closed",
    ANSWERED_ELSEWHERE: "answered-elsewhere"
  },
  ERROR_REASONS: {
    BAD_AUTHENTICATION: "bad authentication",
    BAD_CALLID: "bad callId",
    BAD_REASON: "Invalid reason: should be alphanumeric"
  },
  USER_TYPES: {
    REGISTERED: "Registered",
    UNREGISTERED: "Unregistered",
    UNAUTHENTICATED: "Link-clicker"
  }
};
