Some tools to query the REDIS database
======================================

IDLETIME and TTL warning
------------------------

For now the redis TTL command updates the Least Recently Used value
and thus the IDLETIME of the key.

Some of this tools are based on the TTL command:

 - ``_get_expiration.js``
 - ``_graph_expiration.sh``
 - ``_get_1111579_fxa_impacted.js``
 - ``_get_ttl_hawk.js``

Some of this tool are based on the IDLETIME value:

 - ``get_active_unactive_users.js``
 - ``get_expiration_estimate.js``
 - ``remove_old_keys.js``

The use of one of the first list's command will override the result of
the second list's commands. To prevent errorneous usage, commands
based on TTL have their names prefixed with an ``_``.


Active and Inactive users
-------------------------

 - ``get_active_unactive_users.js``

This script gives you some information about users activity::

    Processing 33 keys
    3 sessions used during the last 24 hours.
    30 sessions not used for the last 24 hours.
    0 sessions not used for the last two weeks.
    0 sessions not used for a month.

It is based on the key idletime.


Average calls per user
----------------------

 - ``get_average_calls_per_user.js``

Return the average number of calls per user::

    processing 21 users having calls.
    22 calls for 21 users having calls.
    Average 1.05 Calls per user.
    22 calls for 21 users having created a call-url.
    Average 1.05 calls per user.


Average call-urls per user
--------------------------

 - ``get_average_call-urls_per_user.js``

Return the average number of call-urls per user::

    processing 21 users
    22 URLs for 21 users.
    Average 1.05 URLs per user.


Average rooms per user
----------------------

 - ``get_average_rooms_per_user.js``

Return the average number of rooms per user::

    processing 4 users
    4 rooms for 4 users.
    Average 1.00 rooms per user.


Keys expirations
----------------

- ``_get_expiration.js``
- ``_graph_expiration.sh``
- ``get_expiration_estimate.js``

Each redis keys has a Time-To-Live so we know when it would exipre.
This script gives you an agenda of what amount of data will expire at which date.

::

    processing 179 keys
    121 keys will never expires. (6077 Bytes)
    2015/1/31	49	49	4944 Bytes	(in 24 days)
    2015/2/6	9	58	907 Bytes	(in 30 days)

You can also use ``_graph_expiration.sh`` to draw an histogram of this data

::

    2015/1/31	49	=================
    2015/2/6	9	====


These two first commands updates the LRU of the keys.

If you want an estimation of the expiration, you can use ``get_expiration_estimate.js``::

This command will display the creation date and the average expiration date::

    Processing 179 keys
    2015/1/7	179	11928 Bytes	(1 days ago)
    2015/1/31	179	11928 Bytes	(in 24 days)

This ``expiration-estimate`` works better when all keys have a TTL
because it cannot detect the one which will never expire.

Also because ``get_expiration_estimate`` is based on the IDLETIME, if you
run it after ``_get_expiration.js`` all keys will have the same expiration
date in the average time.


Impacted users by the FxA bug
-----------------------------

- ``_get_1111579_fxa_impacted.js``

We had Bug 1111579 that was converting some existing authenticated
users into unauthenticated users.

This command let you know the number of impacted sessions and delete broken ones.

::
    $ node _get_1111579_fxa_impacted
    processing 1 keys
    .
    number of impacted users 0 over 1

::

    $ node _get_1111579_fxa_impacted --delete
    processing 1 keys
    .
    number of impacted users 0 over 1
    The keys have been removed from the database


Hawk User Info
--------------

- ``get_hawk_user_info.js``

This script takes an HawkId or HawkIdHmac and give you informations about the user.

Providing an HawkId::

    $ node get_hawk_user_info.js 88d5a28f545bb406ddc6c6a5276cbfe0aa10fdba425f4808e2d6c3acdbfdaeda
    Trying with HawkIdHmac: de9cd5c5ded9e2df982723d96361f56c0d72c936dc177cbff1f147bac1445f63
    { anonymous: false, userId: 'foobar@example.com' }

Providing an HawkIdHmac::

    $ node get_hawk_user_info.js de9cd5c5ded9e2df982723d96361f56c0d72c936dc177cbff1f147bac1445f63
    Trying with HawkIdHmac: dcf3932ac6c0ed48994bb17c5ecc150e03e84a76e523b698c8cc75c2ca278611
    Trying with HawkIdHmac: de9cd5c5ded9e2df982723d96361f56c0d72c936dc177cbff1f147bac1445f63
    { anonymous: false, userId: '<ciphered>' }

Providing an unauthenticated HawkIdHmac::

    $ node get_hawk_user_info.js 81d2afea33181e32023c9042b42157ebf453d3c04435b386ded7c378fb338b01
    Trying with HawkIdHmac: c4c9a59a1a12719e395cb64e35d53d515335612e4b3208c51c89beecaa496393
    Trying with HawkIdHmac: 81d2afea33181e32023c9042b42157ebf453d3c04435b386ded7c378fb338b01
    { anonymous: true }


Redis Usage
-----------

- ``get_redis_usage.js``

This script gives you general information about the redis keys::

    # Server
    [...]

    # Clients
    [...]

    # Memory
    [...]

    # Persistence
    [...]

    # Stats
    [...]

    # Replication
    [...]

    # CPU
    [...]

    # Keyspace
    db0:keys=179,expires=58,avg_ttl=2118094581

     ====

    spurls.*: 	64
    spurls.6e0a93dd218b767f799be64534c01c1f0706361a6b0caba1ca9c8099d2d8078b.6e0a93dd218b767f799be64534c01c1f0706361a6b0caba1ca9c8099d2d8078b
    spurls.a33b8202d462bbfa0bf1559b8ff3e05f710832c5103a142a2263e178810f858f

    callurl.*: 	22
    callurl.we8ADTMY6o8
    callurl.SPwwEPBW7OA

    userUrls.*: 	21
    userUrls.40057524c466604ecad39c88871a896dee5fd4718cd37373f4703db12fbd5ee7
    userUrls.24ce5f27583b5eb2de9655c21a221546e97629e892a871e161ebdab861317829

    call.*: 	0

    userCalls.*: 	18
    userCalls.055620865c42a71a1049d75692411095d9d68ba0843ff4c8a8fc825643c0756e
    userCalls.23cf69cbd9265e9b78444f71c43beee6d7f85976df284af575d5c37d4cf780f6

    callstate.*: 	0

    hawkuser.*: 	1
    hawkuser.de9cd5c5ded9e2df982723d96361f56c0d72c936dc177cbff1f147bac1445f63

    userid.*: 	1
    userid.de9cd5c5ded9e2df982723d96361f56c0d72c936dc177cbff1f147bac1445f63

    hawk.*: 	33
    hawk.fabaf4f9f60c6f8d97158c75f0b9b2661738130eb654eed13d5ecdc8739d0f1a
    hawk.23cf69cbd9265e9b78444f71c43beee6d7f85976df284af575d5c37d4cf780f6

    oauth.token.*: 	1
    oauth.token.de9cd5c5ded9e2df982723d96361f56c0d72c936dc177cbff1f147bac1445f63

    oauth.state.*: 	1
    oauth.state.de9cd5c5ded9e2df982723d96361f56c0d72c936dc177cbff1f147bac1445f63

    userRooms.*: 	4
    userRooms.b8ae434636685b6d31c0b0efb96e649bd67c33c1c3fa9a23caaf3aaf804cfdd9
    userRooms.494e14e5f507317b7392eafb3ca2a2372bd61a5735dbc06d9d70abe74b7d1d57

    rooms.*: 	0


Remove OLD keys
---------------

- ``remove_old_keys.js``

Count and list the keys that where not used for the last 15 days and
propose to remove them.

This command uses the IDLETIME of the key to decide whether to remove
it or not.

::

    Processing 179 keys
    Looking for keys not used since : Thursday, January 08, 2015
    179 keys found. (11928 Bytes)
    Would you like to remove these keys? [y/N]

    No key has been removed.

With the ``--verbose`` option::

    Processing 179 keys
    Looking for keys not used since : Thursday, January 08, 2015
    Selected keys:
    - callurl.we8ADTMY6o8
    - spurls.6e0a93dd218b767f799be64534c01c1f0706361a6b0caba1ca9c8099d2d8078b.6e0a93dd218b767f799be64534c01c1f0706361a6b0caba1ca9c8099d2d8078b
    - userUrls.40057524c466604ecad39c88871a896dee5fd4718cd37373f4703db12fbd5ee7
    - userUrls.24ce5f27583b5eb2de9655c21a221546e97629e892a871e161ebdab861317829
    - hawk.fabaf4f9f60c6f8d97158c75f0b9b2661738130eb654eed13d5ecdc8739d0f1a
    5 keys found. (850 Bytes)
    Would you like to remove these keys? [y/N]


Ping Sentry
-----------

- ``send_sentry.js``

A command that send an error message to Sentry to check the Sentry configuration.


TTL of an Hawk session
----------------------

- ``_get_ttl_hawk.js``

This command tells you the time to live of an hawk session given it's HawkId::

    $ node ttl_hawk.js 88d5a28f545bb406ddc6c6a5276cbfe0aa10fdba425f4808e2d6c3acdbfdaeda
    redis-cli TTL hawk.de9cd5c5ded9e2df982723d96361f56c0d72c936dc177cbff1f147bac1445f63
    expire in 2584761 seconds
