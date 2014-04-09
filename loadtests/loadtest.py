from urlparse import urlparse
import random

from loads.case import TestCase


class TestLoop(TestCase):

    server_url = "http://localhost:5000"

    def test_all(self):
        self.register()
        token = self.generate_token()
        uuid, session, caller_token, api_key = self.initiate_call(token)
        calls = self.list_pending_calls()
        for call in calls:
            # We want to reject 30% of the calls.
            status = 200
            if random.randint(0, 100) <= 30:
                self.discard_call(call['uuid'])
                status = 404
            self.get_call_status(call['uuid'], status)

    def register(self):
        self.app.post_json('/registration', {
            'simple_push_url': 'http://localhost/push'
        })

    def generate_token(self):
        call_url = self.app.post_json(
            '/call-url',
            {'callerId': 'alexis@mozilla.com'}
        ).json['call_url']
        return urlparse(call_url).path.split('/')[-1]

    def initiate_call(self, token):
        res = self.app.post_json('/calls/%s' % token).json
        return (res['uuid'], res['sessionId'], res['sessionToken'],
                res['apiKey'])

    def list_pending_calls(self):
        return self.app.get('/calls?version=200').json['calls']

    def revoke_token(self, token):
        self.app.delete('/calls/%s' % token)

    def discard_call(self, uuid):
        self.app.delete('/calls/id/%s' % uuid)

    def get_call_status(self, uuid, status):
        self.app.get('/calls/id/%s' % uuid, status=status)
