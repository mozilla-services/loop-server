import json
import os
import random
from base64 import b64encode
from six.moves import range

MAX_NUMBER_OF_PEOPLE_JOINING = 5  # Pick a randint between 1 and this value.
PERCENTAGE_OF_REFRESH = 50
PERCENTAGE_OF_MANUAL_LEAVE = 60
PERCENTAGE_OF_MANUAL_ROOM_DELETE = 80
PERCENTAGE_OF_ROOM_CONTEXT = 75


class TestRoomsMixin(object):
    def setupRoom(self):
        self.register({
            "simplePushURLs": {
                "calls": self.simple_push_url,
                "rooms": self.simple_push_url
            }
        })
        room_token = self.create_room()
        num_participants = random.randint(1, MAX_NUMBER_OF_PEOPLE_JOINING)
        self.incr_counter("num-participants-%d" % num_participants)

        self.join_room(room_token, self.hawk_room_owner)

        for x in range(num_participants - 1):
            participant_hawk_auth = self.register()
            self.join_room(room_token, participant_hawk_auth)

            if random.randint(0, 100) < PERCENTAGE_OF_REFRESH:
                self.refresh_room_presence(room_token, participant_hawk_auth)

            if random.randint(0, 100) < PERCENTAGE_OF_MANUAL_LEAVE:
                self.leave_room(room_token, participant_hawk_auth)

        self.leave_room(room_token, self.hawk_room_owner)

        if random.randint(0, 100) < PERCENTAGE_OF_MANUAL_ROOM_DELETE:
            self.delete_room(room_token)

    def create_room(self):
        self.hawk_room_owner = self.hawk_auth
        data = {
            "roomName": "UX Discussion",
            "expiresIn": 1,
            "roomOwner": "Alexis",
            "maxSize": MAX_NUMBER_OF_PEOPLE_JOINING
        }

        if random.randint(0, 100) < PERCENTAGE_OF_ROOM_CONTEXT:
            del data['roomName']
            data['context'] = {
                "value": b64encode(os.urandom(1024)).decode('utf-8'),
                "alg": "AES-GCM",
                "wrappedKey": b64encode(os.urandom(16)).decode('utf-8')
            }
            self.incr_counter("room-with-context")


        resp = self.session.post(
            self.base_url + '/rooms',
            data=json.dumps(data),
            headers={'Content-Type': 'application/json'},
            auth=self.hawk_room_owner
        )
        self.assertEquals(201, resp.status_code,
                          "Room Creation failed with code %s: %s" % (
                              resp.status_code, resp.content))
        self.incr_counter("create-room")
        data = self._get_json(resp)
        return data.get('roomToken')

    def delete_room(self, room_token):
        resp = self.session.delete(
            self.base_url + '/rooms/%s' % room_token,
            headers={'Content-Type': 'application/json'},
            auth=self.hawk_room_owner
        )
        self.assertEquals(204, resp.status_code,
                          "Room deletion failed with code %s: %s" % (
                              resp.status_code, resp.content))
        self.incr_counter("delete-room")

    def join_room(self, room_token, hawk_auth=None):
        if not hawk_auth:
            hawk_auth = self.hawk_auth

        resp = self.session.post(
            self.base_url + '/rooms/%s' % room_token,
            data=json.dumps({
                "action": "join",
                "displayName": "Adam",
                "clientMaxSize": MAX_NUMBER_OF_PEOPLE_JOINING
            }),
            headers={'Content-Type': 'application/json'},
            auth=hawk_auth
        )

        self.assertEquals(200, resp.status_code,
                          "Participant Creation failed with code %s: %s" % (
                              resp.status_code, resp.content))
        self.incr_counter("join-room")

    def refresh_room_presence(self, room_token, hawk_auth=None):
        if not hawk_auth:
            hawk_auth = self.hawk_auth

        resp = self.session.post(
            self.base_url + '/rooms/%s' % room_token,
            data=json.dumps({
                "action": "refresh"
            }),
            headers={'Content-Type': 'application/json'},
            auth=hawk_auth
        )

        self.assertEquals(200, resp.status_code,
                          "Participant refresh failed with code %s: %s" % (
                              resp.status_code, resp.content))
        self.incr_counter("refresh-room-presence")

    def leave_room(self, room_token, hawk_auth=None):
        if not hawk_auth:
            hawk_auth = self.hawk_auth

        resp = self.session.post(
            self.base_url + '/rooms/%s' % room_token,
            data=json.dumps({
                "action": "leave"
            }),
            headers={'Content-Type': 'application/json'},
            auth=hawk_auth
        )

        self.assertEquals(204, resp.status_code,
                          "Room leave failed with code %s: %s" % (
                              resp.status_code, resp.content))
        self.incr_counter("leave-room")
