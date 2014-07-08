from gevent import monkey
monkey.patch_all()

from urlparse import urlparse
import random
import json
import hmac
import hashlib
import math
import gevent
from Queue import Empty
import socket

import mohawk
from requests.auth import AuthBase

from loads.case import TestCase


class TestLoop(TestCase):

    def setUp(self):
        self.wss = []

    def tearDown(self):
        for ws in self.wss:
            ws.close()
            # XXX this is missing in ws4py
            ws._th.join()
            if ws.sock:
                ws.sock.close()

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

        def _handle_callee_messages(message_data):
            message = json.loads(message_data.data)
            callee_alerts.append(message)
            if (message['messageType'] == "hello"
                    and message['state'] == "init"):
                # just keep it open and wait!
                pass
                #rcv = callee_ws.receive()

        def _handle_caller_messages(message_data):
            message = json.loads(message_data.data)
            caller_alerts.append(message)

            if (message['messageType'] == "hello"
                    and message['state'] == "init"):
                # This is the first message, we should have the second party
                # connect.
                callee_ws.send(json.dumps({
                    'messageType': 'hello',
                    'auth': calls[0]['websocketToken'],
                    'callId': call_id
                }))

                callee_ws.receive()

        # let's connect to the web socket until it gets closed
        callee_ws = self.create_ws(
            progress_url,
            callback=_handle_callee_messages)

        caller_ws = self.create_ws(
            progress_url,
            callback=_handle_caller_messages)

        caller_ws.send(json.dumps({
            'messageType': 'hello',
            'auth': websocket_token,
            'callId': call_id
        }))

        while len(caller_alerts) < 2:
            gevent.sleep(.1)

        # here assert on the content
        self.assertEqual(len(callee_alerts), 2)

    def _get_json(self, resp):
        try:
            return resp.json()
        except Exception:
            print resp.text
            raise

    def register(self):
        resp = self.session.post(
            self.server_url + '/registration',
            data={'simple_push_url': 'http://httpbin.org/deny'})
        self.assertEquals(200, resp.status_code,
                          "Registration failed: %s" % resp.content)

        try:
            self.hawk_auth = HawkAuth(
                self.server_url,
                resp.headers['hawk-session-token'])
        except KeyError:
            print resp
            raise

    def generate_token(self):
        resp = self.session.post(
            self.server_url + '/call-url',
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
            self.server_url + '/calls/%s' % token,
            data=json.dumps({"callType": "audio-video"}),
            headers={'Content-Type': 'application/json'}
        )
        self.assertEquals(resp.status_code, 200,
                          "Call Initialization failed: %s" % resp.content)

        return self._get_json(resp)

    def list_pending_calls(self):
        resp = self.session.get(
            self.server_url + '/calls?version=200',
            auth=self.hawk_auth)
        data = self._get_json(resp)
        return data['calls']

    def revoke_token(self, token):
        # You don't need to be authenticated to revoke a token.
        self.session.delete(self.server_url + '/call-url/%s' % token)


def HKDF_extract(salt, IKM, hashmod=hashlib.sha256):
    """HKDF-Extract; see RFC-5869 for the details."""
    if salt is None:
        salt = b"\x00" * hashmod().digest_size
    return hmac.new(salt, IKM, hashmod).digest()


def HKDF_expand(PRK, info, L, hashmod=hashlib.sha256):
    """HKDF-Expand; see RFC-5869 for the details."""
    digest_size = hashmod().digest_size
    N = int(math.ceil(L * 1.0 / digest_size))
    assert N <= 255
    T = b""
    output = []
    for i in xrange(1, N + 1):
        data = T + info + chr(i)
        T = hmac.new(PRK, data, hashmod).digest()
        output.append(T)
    return b"".join(output)[:L]


def HKDF(secret, salt, info, size, hashmod=hashlib.sha256):
    """HKDF-extract-and-expand as a single function."""
    PRK = HKDF_extract(salt, secret, hashmod)
    return HKDF_expand(PRK, info, size, hashmod)


class HawkAuth(AuthBase):
    def __init__(self, server_url, tokendata):
        hawk_session = tokendata.decode('hex')
        self.server_url = server_url
        keyInfo = 'identity.mozilla.com/picl/v1/sessionToken'
        keyMaterial = HKDF(hawk_session, "", keyInfo, 32*3)
        self.credentials = {
            'id': keyMaterial[:32].encode("hex"),
            'key': keyMaterial[32:64].encode("hex"),
            'algorithm': 'sha256'
        }

    def __call__(self, r):
        r.headers['Host'] = urlparse(self.server_url).netloc
        sender = mohawk.Sender(
            self.credentials,
            r.url,
            r.method,
            content=r.body or '',
            content_type=r.headers.get('Content-Type', '')
        )

        r.headers['Authorization'] = sender.request_header
        return r
