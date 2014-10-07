#!/bin/bash
host="$1"
redis-cli -h "$host" info
 
echo -e "========\n\n"
for key in "spurl" "callurl" "userUrls" "call" "userCalls" "callstate" "hawkuser" "userid" "hawk" "oauth.token" "oauth.state"
do
	echo "Keys for $key.*"
	echo "====================="
	redis-cli -h $host KEYS "$key.*" | grep -v '^$' > tmp
	head -n 5 tmp
	echo -n "Total of keys: "
	cat tmp | wc -l | sort -k 2 -nr
	rm tmp
	echo -e "\n"
done
