import json
from requests_hawk import HawkAuth


class TestThrottleMixin(object):

    def test_throttling(self):
        # make sure we get rejected if we generate too many call-urls
        self._register()
        res = [self._generate_call_url() for i in range(100)]
        self.assertTrue(429 in res)

        # XXX todo, wait a bit and make sure we can generate call urls again

    def _register(self, data=None):
        if data is None:
            data = {'simple_push_url': 'http://httpbin.org/deny'}
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

    def _generate_call_url(self):
        resp = self.session.post(
            self.base_url + '/call-url',
            data=json.dumps({'callerId': 'alexis@mozilla.com'}),
            headers={'Content-Type': 'application/json'},
            auth=self.hawk_auth
        )
        self.incr_counter("generate-call-url")
        return resp.status_code
