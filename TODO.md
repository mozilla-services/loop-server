# Rooms

## Questions

- Do we want to have a default value for some parameters on POST /rooms?
- What the default configuration should be, with hints from us.
- What should be the size of the room token? 8 Bytes for now.
- Should we dedupe the users in the room?

## Code & Test

+ PUT /rooms/token should be PATCH. (+to say)
+ Rename req.roomData in req.roomStorageData
+ Use a local roomData var instead of updating req.roomData
+ Check the room owner on patch and delete
- WebApp Url should be refactored.
- add user renamed to set user (addUserRoomData)
- manage the participants in GET /rooms/token and DELETE
- Handle the TokBox channel on /rooms (+to say)
- We should add CORS handling and test it.

## To say

- It's not a 200 it's a 201 on resource creation;
- Handle the TokBox channel on /rooms;
- PUT /rooms/token should be PATCH.
