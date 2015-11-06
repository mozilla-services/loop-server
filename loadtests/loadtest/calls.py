import json
import os
import uuid
from six.moves.urllib.parse import urlparse
from requests_hawk import HawkAuth

from fxa.core import Client
from fxa import errors
from fxa.plugins.requests import FxABrowserIDAuth

# XXX Using the same fxa as the dev server, as the staging setup isn't working
# for me.
DEFAULT_FXA_URL = "https://api-accounts.stage.mozaws.net"
ERROR_ACCOUNT_EXISTS = 101


class TestCallsMixin(object):
    def setupCall(self):
        self.register(auth=self.auth)
        call_data = self.initiate_call()
        calls = self.list_pending_calls()
        return call_data, calls

    def get_auth(self):
        self.account_server_url = os.getenv("FXA_URL", DEFAULT_FXA_URL)
        random_user = uuid.uuid4().hex
        self.user_email = "loop-%s@restmail.net" % random_user
        client = Client(self.account_server_url)
        try:
            client.create_account(self.user_email,
                                  password=random_user,
                                  preVerified=True)
        except errors.ClientError as e:
            if e.errno != ERROR_ACCOUNT_EXISTS:
                raise

        url = urlparse(self.base_url)
        audience = "%s://%s" % (url.scheme, url.hostname)

        return FxABrowserIDAuth(
            self.user_email,
            password=random_user,
            audience=audience,
            server_url=self.account_server_url)

    def register(self, data=None, auth=None):
        if data is None:
            data = {'simple_push_url': self.simple_push_url}

        resp = self.session.post(
            self.base_url + '/registration',
            data=json.dumps(data),
            auth=auth,
            headers={'Content-Type': 'application/json'})
        self.assertEquals(200, resp.status_code,
                          "Registration failed: %s" % resp.content)

        try:
            self.hawk_auth = HawkAuth(
                hawk_session=resp.headers['hawk-session-token'],
                server_url=self.server_url)
        except KeyError:
            print resp
            raise
        else:
            self.incr_counter("register")
            return self.hawk_auth

    def initiate_call(self):
        # This happens when not authenticated.
        resp = self.session.post(
            self.base_url + '/calls',
            data=json.dumps({'calleeId': self.user_email,
                             'callType': 'audio-video'}),
            headers={'Content-Type': 'application/json'},
            auth=self.hawk_auth
        )
        self.assertEquals(resp.status_code, 200,
                          "Call Initialization failed: %s" % resp.content)
        self.incr_counter("initiate-call")

        return self._get_json(resp)

    def list_pending_calls(self):
        resp = self.session.get(
            self.base_url + '/calls?version=200',
            auth=self.hawk_auth)
        self.assertEquals(resp.status_code, 200,
                          "List calls failed: %s" % resp.content)
        self.incr_counter("list-pending-calls")
        data = self._get_json(resp)
        return data['calls']

    def revoke_token(self, token):
        # You don't need to be authenticated to revoke a token.
        resp = self.session.delete(self.base_url + '/call-url/%s' % token)
        self.assertEquals(resp.status_code, 204,
                          "Revoke call-url token failed: %s" % resp.content)
        self.incr_counter("revoke_token")

    def test_401_with_stale_timestamp(self):
        data = {'simple_push_url': self.simple_push_url}
        resp = self.session.post(
            self.base_url + '/registration',
            data=json.dumps(data),
            headers={'Content-Type': 'application/json'})
        self.assertEquals(200, resp.status_code,
                          "Registration failed: %s" % resp.content)

        try:
            hawk_auth = HawkAuth(
                hawk_session=resp.headers['hawk-session-token'],
                server_url=self.server_url, _timestamp=1431698847)
        except KeyError:
            print resp
            raise
        else:
            resp = self.session.post(
                self.base_url + '/registration',
                data=json.dumps({'simple_push_url': self.simple_push_url}),
                headers={'Content-Type': 'application/json'},
                auth=hawk_auth
            )
            self.assertEquals(resp.status_code, 401,
                              "Staled timestamp verification failed.")
            self.incr_counter("stale-timestamp-verification")
