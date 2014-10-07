#!/bin/bash
host="$1"
redis-cli -h "$host" info
 
echo -e "========\n\n"
for key in "spurl" "callurl" "userUrls" "call" "userCalls" "callstate" "hawkuser" "userid" "hawk" "oauth.token" "oauth.state"
do
	echo -n "Number of keys for $key "
	redis-cli -h $host KEYS "$key.*" | wc -l | sort -k 2 -nr
done
