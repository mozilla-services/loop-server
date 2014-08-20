from gevent import monkey
monkey.patch_all()

import json
import gevent

from requests_hawk import HawkAuth


from loads.case import TestCase


class TestLoop(TestCase):

    def setUp(self):
        self.wss = []
        self.base_url = self.server_url + "/v0"

    def tearDown(self):
        for ws in self.wss:
            ws.close()
            # XXX this is missing in ws4py
            ws._th.join()
            if ws.sock:
                ws.sock.close()

    def _send_ws_message(self, ws, **msg):
        return ws.send(json.dumps(msg))

    def create_ws(self, *args, **kw):
        ws = TestCase.create_ws(self, *args, **kw)
        self.wss.append(ws)
        return ws

    def test_all(self):
        self.register()
        token = self.generate_token()
        call_data = self.initiate_call(token)
        calls = self.list_pending_calls()
        self._test_websockets(token, call_data, calls)

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

    def _get_json(self, resp):
        try:
            return resp.json()
        except Exception:
            print resp.text
            raise

    def register(self):
        resp = self.session.post(
            self.base_url + '/registration',
            data={'simple_push_url': 'http://httpbin.org/deny'})
        self.assertEquals(200, resp.status_code,
                          "Registration failed: %s" % resp.content)

        try:
            self.hawk_auth = HawkAuth(
                hawk_session=resp.headers['hawk-session-token'],
                server_url=self.server_url)
        except KeyError:
            print resp
            raise

    def generate_token(self):
        resp = self.session.post(
            self.base_url + '/call-url',
            data=json.dumps({'callerId': 'alexis@mozilla.com'}),
            headers={'Content-Type': 'application/json'},
            auth=self.hawk_auth
        )
        self.assertEquals(resp.status_code, 200,
                          "Call-Url creation failed: %s" % resp.content)
        data = self._get_json(resp)
        call_url = data.get('callUrl', data.get('call_url'))
        return call_url.split('/').pop()

    def initiate_call(self, token):
        # This happens when not authenticated.
        resp = self.session.post(
            self.base_url + '/calls/%s' % token,
            data=json.dumps({"callType": "audio-video"}),
            headers={'Content-Type': 'application/json'}
        )
        self.assertEquals(resp.status_code, 200,
                          "Call Initialization failed: %s" % resp.content)

        return self._get_json(resp)

    def list_pending_calls(self):
        resp = self.session.get(
            self.base_url + '/calls?version=200',
            auth=self.hawk_auth)
        data = self._get_json(resp)
        return data['calls']

    def revoke_token(self, token):
        # You don't need to be authenticated to revoke a token.
        self.session.delete(self.base_url + '/call-url/%s' % token)
