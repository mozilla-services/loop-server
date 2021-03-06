# Rooms


## Questions

- How do we handle the link clicker session?
- How do we handle two participants asking for the same displayName?


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
+ Test roomUserSimplePush to be called on updateTime.
+ Add test to make sure updatedTime is updated on:
   + user join
   + user leaves
+ Test notification on POST / PATCH / DELETE /rooms
+ Add a test to check participants expiricy (doesn't return items when not needed);
+ Handle the account property in the participant obj.
+ Encrypt account information in the database.
+ Update the load test scripts
- Update the memory usage script with rooms (+ other stuff that needs to be updated)
- Handle the TokBox channel on /rooms (+to say)


## To say

- It's not a 200 it's a 201 on resource creation;
+ PUT /rooms/token should be PATCH;
- Handle the TokBox channel on /rooms;
