#! /bin/bash
# This script is to run frequently on the server.
# Every our or half-hour.

NOW=$(date "+%s")

echo "-- ./dropExpiredData.sh | mysql -u travis looptest"
echo "--"
echo "DELETE FROM \`hawkSession\` WHERE \`expires\` < ${NOW};"
echo "DELETE FROM \`sessionSPURLs\` WHERE \`expires\` < ${NOW};"
echo "DELETE FROM \`callURL\` WHERE \`expires\` < ${NOW};"
echo "DELETE FROM \`call\` WHERE \`expires\` < ${NOW};"
echo "DELETE FROM \`room\` WHERE \`expiresAt\` < ${NOW};"
echo "DELETE FROM \`roomParticipant\` WHERE \`expires\` < ${NOW};"
