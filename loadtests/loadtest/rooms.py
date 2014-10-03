import json


class TestRoomsMixin(object):
    def create_room(self):
        resp = self.session.post(
            self.base_url + '/rooms',
            data=json.dumps({
                "roomName": "UX Discussion",
                "expiresIn": 1,
                "roomOwner": "Alexis",
                "maxSize": 10
            }),
            headers={'Content-Type': 'application/json'},
            auth=self.hawk_auth
        )
        self.assertEquals(201, resp.status_code,
                          "Room Creation failed with code %s: %s" % (
                              resp.status_code, resp.content))
        data = self._get_json(resp)
        return data.get('roomToken')

    def delete_room(self, room_token):
        resp = self.session.delete(
            self.base_url + '/rooms/%s' % room_token,
            headers={'Content-Type': 'application/json'}
        )

        self.assertEquals(200, resp.status_code,
                          "Room deletion failed with code %s: %s" % (
                              resp.status_code, resp.content))

    def join_room(self, room_token, hawk_auth=None):
        if not hawk_auth:
            hawk_auth = self.hawk_auth

        resp = self.session.post(
            self.base_url + '/rooms/%s' % room_token,
            data=json.dumps({
                "action": "join",
                "displayName": "Adam",
                "clientMaxSize": 2
            }),
            headers={'Content-Type': 'application/json'}
        )

        self.assertEquals(200, resp.status_code,
                          "Participant Creation failed with code %s: %s" % (
                              resp.status_code, resp.content))

    def refresh_room_presence(self, room_token, hawk_auth=None):
        if not hawk_auth:
            hawk_auth = self.hawk_auth

        resp = self.session.post(
            self.base_url + '/rooms/%s' % room_token,
            data=json.dumps({
                "action": "refresh"
            }),
            headers={'Content-Type': 'application/json'}
        )

        self.assertEquals(200, resp.status_code,
                          "Participant refresh failed with code %s: %s" % (
                              resp.status_code, resp.content))

    def leave_room(self, room_token, hawk_auth=None):
        if not hawk_auth:
            hawk_auth = self.hawk_auth

        resp = self.session.post(
            self.base_url + '/rooms/%s' % room_token,
            data=json.dumps({
                "action": "leave"
            }),
            headers={'Content-Type': 'application/json'}
        )

        self.assertEquals(200, resp.status_code,
                          "Room leave failed with code %s: %s" % (
                              resp.status_code, resp.content))
