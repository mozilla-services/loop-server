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
    TIMEOUT: "timeout"
  },
  ERROR_REASONS: {
    BAD_AUTHENTICATION: "bad authentication",
    BAD_CALLID: "bad callId"
  }
};
