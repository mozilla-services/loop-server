from gevent import monkey
monkey.patch_all()

from .calls import TestCallsMixin
from .rooms import TestRoomsMixin
from .websocket import TestWebsocketMixin

from loads.case import TestCase
import os
DEFAULT_SIMPLE_PUSH_URL = "https://call.stage.mozaws.net/"


class TestLoop(TestCallsMixin, TestRoomsMixin, TestWebsocketMixin, TestCase):
    def __init__(self, *args, **kwargs):
        super(TestLoop, self).__init__(*args, **kwargs)
        r = self.session.get(self.server_url)
        self.base_url = r.request.url.rstrip('/')
        self.simple_push_url = os.getenv("SIMPLE_PUSH_URL",
                                         DEFAULT_SIMPLE_PUSH_URL)
        # Only create the restmail account once.
        self.auth = self.getAuth()

    def setUp(self):
        self.wss = []

    def tearDown(self):
        for ws in self.wss:
            ws.close()
            # XXX this is missing in ws4py
            ws._th.join()
            if ws.sock:
                ws.sock.close()

    def test_all(self):
        self.test_http_calls()
        self._test_websockets_basic_scenario()

    def test_http_calls(self):
        self.setupCall()
        self.setupRoom()

    def test_websockets(self):
        self._test_websockets_basic_scenario()
        self._test_websockets_supervisory_timeout()
        self._test_websockets_connection_timeout()
        self._test_websockets_ringing_timeout()

    def _get_json(self, resp):
        try:
            return resp.json()
        except Exception:
            print resp.text
            raise
