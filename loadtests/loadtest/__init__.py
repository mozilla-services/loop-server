from gevent import monkey
monkey.patch_all()

from .calls import TestCallsMixin
from .rooms import TestRoomsMixin
from .websocket import TestWebsocketMixin

from loads.case import TestCase


class TestLoop(TestCallsMixin, TestRoomsMixin, TestWebsocketMixin, TestCase):
    def __init__(self, *args, **kwargs):
        super(TestLoop, self).__init__(*args, **kwargs)
        r = self.session.get(self.server_url)
        self.base_url = r.request.url.rstrip('/')

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
        params = self.setupCall()
        self._test_websockets(*params)
        self.setupRoom()

    def _get_json(self, resp):
        try:
            return resp.json()
        except Exception:
            print resp.text
            raise
