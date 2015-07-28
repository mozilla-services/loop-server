import json
import os
import uuid
from six.moves.urllib.parse import urlparse
from requests_hawk import HawkAuth

import fxa.oauth
from fxa.core import Client
from fxa.tests.utils import TestEmailAccount
from fxa.plugins.requests import FxABrowserIDAuth

# XXX Using the same fxa as the dev server, as the staging setup isn't working
# for me.
DEFAULT_FXA_URL = "https://api.accounts.firefox.com/v1"


class TestCallsMixin(object):
    def setupCall(self):
        self.register(auth=self.auth)
        call_data = self.initiate_call()
        calls = self.list_pending_calls()
        return call_data, calls

    def getAuth(self):
        self.account_server_url = os.getenv("FXA_URL", DEFAULT_FXA_URL)
        random_user = uuid.uuid4().hex
        self.user_email = "loop-%s@restmail.net" % random_user
        acct = TestEmailAccount(self.user_email)
        client = Client(self.account_server_url)
        fxa_session = client.create_account(self.user_email,
                                            password=random_user)
        def is_verify_email(m):
            return "x-verify-code" in m["headers"]

        message = acct.wait_for_email(is_verify_email)
        fxa_session.verify_email_code(message["headers"]["x-verify-code"])

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
