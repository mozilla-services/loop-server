from __future__ import print_function
import redis

r = redis.StrictRedis(host='localhost', port=6379, db=0)
keys = r.keys('userUrls.*')

acc = 0.
for key in keys:
    acc += r.scard(key)

print("average is %s" % (acc / len(keys)))
