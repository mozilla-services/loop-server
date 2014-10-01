# Rooms


## Questions

- Do we want to have a default value for some parameters on POST /rooms?
- What the default configuration should be, with hints from us.
- What should be the size of the room token? 8 Bytes for now.
- Should we dedupe the users in the room? (a participant per device or per account)
- Should everyone be able to list all the participants to a room, or should that be only for participants?


## Code & Test

+ PUT /rooms/token should be PATCH. (+to say)
+ Rename req.roomData in req.roomStorageData
+ Use a local roomData var instead of updating req.roomData
+ Check the room owner on patch and delete
+ Rename addUserRoomData to setUserRoomData
+ manage the participants in GET /rooms/token and DELETE
+ Do not let non-participants get room info (appart owner).
+ Handle rejection of new participants if the room is full.
+ Write storage test for participant related methods
+ We should add CORS handling and test it.
+ WebApp Url should be refactored.
+ POST /rooms/:token — handle refresh
+ POST /rooms/:token — handle leave
+ GET /rooms should return user rooms
+ GET /rooms should handle the ?version parameter.
- Add test to make sure updatedTime is updated on:
   - user join
   - user leaves
- Handle the TokBox channel on /rooms (+to say)
- Handle the account property in the participant obj.
- Add a test to check participants expiricy (doesn't return items when not needed);
- update the memory usage script with rooms (+ other stuff that needs to be updated)
- update the load test scripts


## To say

- It's not a 200 it's a 201 on resource creation;
- Handle the TokBox channel on /rooms;
+ PUT /rooms/token should be PATCH.
