import gevent
import json

from loads.case import TestCase


class TestWebsocketMixin(object):
    def _send_ws_message(self, ws, **msg):
        return ws.send(json.dumps(msg))

    def create_ws(self, *args, **kw):
        ws = TestCase.create_ws(self, *args, **kw)
        self.wss.append(ws)
        return ws

    def _test_websockets(self, token, call_data, calls):
        progress_url = call_data['progressURL']
        websocket_token = call_data['websocketToken']
        call_id = call_data['callId']
        caller_alerts = []
        callee_alerts = []

        self.connected = False

        def _handle_callee(message_data):
            message = json.loads(message_data.data)
            callee_alerts.append(message)
            state = message.get('state')
            messageType = message.get('messageType')

            if messageType == "progress" and state == "connecting":
                self._send_ws_message(
                    callee_ws,
                    messageType="action",
                    event="media-up")
                caller_ws.receive()

            elif messageType == "progress" and state == "connected":
                self.connected = True

        def _handle_caller(message_data):
            message = json.loads(message_data.data)
            caller_alerts.append(message)
            state = message.get('state')
            messageType = message.get('messageType')

            if messageType == "hello" and state == "init":
                # This is the first message, Ask the second party to connect.
                self._send_ws_message(
                    callee_ws,
                    messageType='hello',
                    auth=calls[0]['websocketToken'],
                    callId=call_id)
                callee_ws.receive()

            elif messageType == "progress" and state == "alerting":
                self._send_ws_message(
                    caller_ws,
                    messageType="action",
                    event="accept")
                callee_ws.receive()

            elif messageType == "progress" and state == "connecting":
                self._send_ws_message(
                    caller_ws,
                    messageType="action",
                    event="media-up")
                callee_ws.receive()

            elif messageType == "progress" and state == "half-connected":
                caller_ws.receive()

            elif messageType == "progress" and state == "connected":
                self.connected = True

        # let's connect to the web socket until it gets closed
        callee_ws = self.create_ws(progress_url, callback=_handle_callee)
        caller_ws = self.create_ws(progress_url, callback=_handle_caller)

        self._send_ws_message(
            caller_ws,
            messageType='hello',
            auth=websocket_token,
            callId=call_id)

        while not self.connected:
            gevent.sleep(.5)

    def test_supervisory_timeout(self):
        """
        Should wait until the supervisory timeout terminate
        the call setup.

        """
        params = self.setupCall()
        progress_url = params[1]['progressURL']
        websocket_token = params[1]['websocketToken']
        call_id = params[1]['callId']
        caller_alerts = []

        self.terminated = False

        def _handle_caller(message_data):
            message = json.loads(message_data.data)
            caller_alerts.append(message)
            state = message.get('state')
            messageType = message.get('messageType')
            reason = message.get("reason")

            if messageType == "hello" and state == "init":
                # This is the first message, Ask the second party to connect.
                pass

            elif messageType == "progress" and state == "terminated":
                if reason == "timeout":
                    self.terminated = True
                else:
                    self.fail("Reason is not timeout: %s" % reason)

        caller_ws = self.create_ws(progress_url, callback=_handle_caller)

        self._send_ws_message(
            caller_ws,
            messageType='hello',
            auth=websocket_token,
            callId=call_id)

        while not self.terminated:
            gevent.sleep(.5)

    def test_ringing_timeout(self):
        """
        Should wait until the ringing timeout terminate
        the call setup.

        """
        params = self.setupCall()
        progress_url = params[1]['progressURL']
        websocket_token = params[1]['websocketToken']
        call_id = params[1]['callId']
        calls = params[2]
        caller_alerts = []

        self.terminated = False

        def _handle_callee(message_data):
            pass

        def _handle_caller(message_data):
            message = json.loads(message_data.data)
            caller_alerts.append(message)
            state = message.get('state')
            messageType = message.get('messageType')
            reason = message.get("reason")

            if messageType == "hello" and state == "init":
                # This is the first message, Ask the second party to connect.
                self._send_ws_message(
                    callee_ws,
                    messageType='hello',
                    auth=calls[0]['websocketToken'],
                    callId=call_id)

            elif messageType == "progress" and state == "terminated":
                if reason == "timeout":
                    self.terminated = True
                else:
                    self.fail("Reason is not timeout: %s" % reason)

        callee_ws = self.create_ws(progress_url, callback=_handle_callee)
        caller_ws = self.create_ws(progress_url, callback=_handle_caller)

        self._send_ws_message(
            caller_ws,
            messageType='hello',
            auth=websocket_token,
            callId=call_id)

        while not self.terminated:
            gevent.sleep(.5)

    def test_connection_timeout(self):
        """
        Should wait until the ringing timeout terminate
        the call setup.

        """
        params = self.setupCall()
        progress_url = params[1]['progressURL']
        websocket_token = params[1]['websocketToken']
        call_id = params[1]['callId']
        calls = params[2]
        caller_alerts = []

        self.terminated = False

        def _handle_callee(message_data):
            message = json.loads(message_data.data)
            caller_alerts.append(message)
            state = message.get('state')
            messageType = message.get('messageType')
            reason = message.get("reason")

            if messageType == "progress" and state == "connecting":
                self._send_ws_message(
                    callee_ws,
                    messageType="action",
                    event="media-up")
                caller_ws.receive()
            elif messageType == "progress" and state == "terminated":
                if reason == "timeout":
                    self.terminated = True
                else:
                    self.fail("Reason is not timeout: %s" % reason)

        def _handle_caller(message_data):
            message = json.loads(message_data.data)
            caller_alerts.append(message)
            state = message.get('state')
            messageType = message.get('messageType')

            if messageType == "hello" and state == "init":
                # This is the first message, Ask the second party to connect.
                self._send_ws_message(
                    callee_ws,
                    messageType='hello',
                    auth=calls[0]['websocketToken'],
                    callId=call_id)

            elif messageType == "progress" and state == "alerting":
                self._send_ws_message(
                    caller_ws,
                    messageType="action",
                    event="accept")
                callee_ws.receive()

        callee_ws = self.create_ws(progress_url, callback=_handle_callee)
        caller_ws = self.create_ws(progress_url, callback=_handle_caller)

        self._send_ws_message(
            caller_ws,
            messageType='hello',
            auth=websocket_token,
            callId=call_id)

        while not self.terminated:
            gevent.sleep(.5)

