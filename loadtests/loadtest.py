from urlparse import urlparse
import random
import json
import hmac
import hashlib
import math

import mohawk
from requests.auth import AuthBase

from loads.case import TestCase


class TestLoop(TestCase):

    def test_all(self):
        self.register()
        token = self.generate_token()
        call_id, session, caller_token, api_key = self.initiate_call(token)
        calls = self.list_pending_calls()
        for call in calls:
            # We want to reject 30% of the calls.
            status = 200
            if random.randint(0, 100) <= 30:
                self.discard_call(call['callId'])
                status = 404
            self.get_call_status(call['callId'], status)

    def register(self):
        resp = self.session.post(
            self.server_url + '/registration',
            data={'simple_push_url': 'http://localhost/push'})

        self.hawk_auth = HawkAuth(
            self.server_url,
            resp.headers['hawk-session-token'])

    def generate_token(self):
        resp = self.session.post(
            self.server_url + '/call-url',
            data=json.dumps({'callerId': 'alexis@mozilla.com'}),
            headers={'Content-type': 'application/json'},
            auth=self.hawk_auth
        )
        call_url = resp.json()['call_url']
        return urlparse(call_url).path.split('/')[-1]

    def initiate_call(self, token):
        # This happens when not authenticated.
        res = self.session.post(self.server_url + '/calls/%s' % token).json()
        return (res['callId'], res['sessionId'], res['sessionToken'],
                res['apiKey'])

    def list_pending_calls(self):
        resp = self.session.get(
            self.server_url + '/calls?version=200',
            auth=self.hawk_auth)
        return resp.json()['calls']

    def revoke_token(self, token):
        # You don't need to be authenticated to revoke a token.
        self.session.delete(self.server_url + '/call-url/%s' % token)

    def discard_call(self, call_id):
        self.session.delete(self.server_url + '/calls/id/%s' % call_id)

    def get_call_status(self, call_id, status):
        resp = self.session.get(self.server_url + '/calls/id/%s' % call_id)
        self.assertEqual(resp.status_code, status)


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
