import json
from requests_hawk import HawkAuth


class TestCallsMixin(object):
    def setupCall(self):
        self.register()
        token = self.generate_call()
        call_data = self.initiate_call(token)
        calls = self.list_pending_calls()
        return token, call_data, calls

    def register(self, data=None):
        if data is None:
            data = {'simple_push_url': self.simple_push_url}
        resp = self.session.post(
            self.base_url + '/registration',
            data=json.dumps(data),
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

    def generate_call(self):
        resp = self.session.post(
            self.base_url + '/calls',
            data=json.dumps({'callerId': 'alexis@mozilla.com'}),
            headers={'Content-Type': 'application/json'},
            auth=self.hawk_auth
        )
        self.assertEquals(resp.status_code, 200,
                          "Call creation failed: %s" % resp.content)
        self.incr_counter("generate-call-url")
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
