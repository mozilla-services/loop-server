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

    def _test_websockets_basic_scenario(self):
        token, call_data, calls = self.setupCall()
        progress_url = call_data['progressURL']
        caller_websocket_token = call_data['websocketToken']
        callee_websocket_token = calls[0]['websocketToken']
        call_id = call_data['callId']
        caller_alerts = []
        callee_alerts = []

        self.connected = False

        def _handle_callee(message_data):
            self.incr_counter("websocket-basic-callee-messages")
            message = json.loads(message_data.data)
            callee_alerts.append(message)
            state = message.get('state')
            messageType = message.get('messageType')

            if messageType == "progress" and state == "alerting":
                self._send_ws_message(
                    callee_ws,
                    messageType="action",
                    event="accept")
                caller_ws.receive()

            elif messageType == "progress" and state == "half-connected":
                self._send_ws_message(
                    callee_ws,
                    messageType="action",
                    event="media-up")
                callee_ws.receive()

            elif messageType == "progress" and state == "connected":
                self.connected = True

        def _handle_caller(message_data):
            self.incr_counter("websocket-basic-caller-messages")
            message = json.loads(message_data.data)
            caller_alerts.append(message)
            state = message.get('state')
            messageType = message.get('messageType')

            if messageType == "hello" and state == "init":
                # This is the first message, Ask the second party to connect.
                self._send_ws_message(
                    callee_ws,
                    messageType='hello',
                    auth=callee_websocket_token,
                    callId=call_id)
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
            auth=caller_websocket_token,
            callId=call_id)

        while not self.connected:
            gevent.sleep(.5)

    def _test_websockets_supervisory_timeout(self):
        """
        The client waits until the supervisory timeout is triggered.
        Supervisory timeout means no-one connected the websocket on the other
        side.

        """
        token, call_data, calls = self.setupCall()
        progress_url = call_data['progressURL']
        caller_websocket_token = call_data['websocketToken']
        callee_websocket_token = calls[0]['websocketToken']
        call_id = call_data['callId']
        caller_alerts = []
        callee_alerts = []

        self.terminated = False

        def _handle_caller(message_data):
            self.incr_counter("websocket-supervisory-caller-messages")
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
            auth=caller_websocket_token,
            callId=call_id)

        while not self.terminated:
            gevent.sleep(.5)

    def _test_websockets_ringing_timeout(self):
        """
        When the server connected with both caller and callee, the callee
        devices should stop ringing after some time.

        """
        token, call_data, calls = self.setupCall()
        progress_url = call_data['progressURL']
        caller_websocket_token = call_data['websocketToken']
        callee_websocket_token = calls[0]['websocketToken']
        call_id = call_data['callId']
        caller_alerts = []
        callee_alerts = []

        self.terminated = False

        def _handle_callee(message_data):
            self.incr_counter("websocket-ringing-callee-messages")

        def _handle_caller(message_data):
            self.incr_counter("websocket-ringing-caller-messages")
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
                    auth=callee_websocket_token,
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
            auth=caller_websocket_token,
            callId=call_id)

        while not self.terminated:
            gevent.sleep(.5)

    def _test_websockets_connection_timeout(self):
        """
        When the callee answered but media-up isn't sent by both parties, the
        server should close the connection after some time.

        """
        token, call_data, calls = self.setupCall()
        progress_url = call_data['progressURL']
        caller_websocket_token = call_data['websocketToken']
        callee_websocket_token = calls[0]['websocketToken']
        call_id = call_data['callId']
        caller_alerts = []
        callee_alerts = []

        self.terminated = False

        def _handle_callee(message_data):
            message = json.loads(message_data.data)
            caller_alerts.append(message)
            state = message.get('state')
            messageType = message.get('messageType')
            reason = message.get("reason")

            if messageType == "progress" and state == "alerting":
                self._send_ws_message(
                    callee_ws,
                    messageType="action",
                    event="accept")
                callee_ws.receive()

            elif messageType == "progress" and state == "connecting":
                self._send_ws_message(
                    callee_ws,
                    messageType="action",
                    event="media-up")
                callee_ws.receive()

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
                    auth=callee_websocket_token,
                    callId=call_id)

        callee_ws = self.create_ws(progress_url, callback=_handle_callee)
        caller_ws = self.create_ws(progress_url, callback=_handle_caller)

        self._send_ws_message(
            caller_ws,
            messageType='hello',
            auth=caller_websocket_token,
            callId=call_id)

        while not self.terminated:
            gevent.sleep(.5)

