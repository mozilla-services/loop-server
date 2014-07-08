Loop server
===========

[![Build Status](https://travis-ci.org/mozilla-services/loop-server.svg?branch=master)](https://travis-ci.org/mozilla-services/loop-server)

This is the server part of the loop project. You can find more information on
its APIs by looking at [the online documentation](https://docs.services.mozilla.com/loop/)

How to install?
---------------

You will need redis-server installed:

### Linux

    apt-get install redis-server

or

    yum install redis

### OS X

Assuming you have brew installed, use it to install redis:

    brew install redis

If you need to restart it (after configuration update):

    brew services restart redis

### All Platforms

Then clone the loop server and install its dependencies:

    git clone https://github.com/mozilla/loop-server.git
    cd loop-server && make install

How to run it?
--------------

You can create your configuration file in `config/{NODE_ENV}.json`

`dev` is the environment by default. In order to run the server, you'll need to
create a `dev.json` file in the config folder. You can do so by using this
command:

    cp config/{sample,dev}.json

Be sure to edit the content of `config/dev.json`. You'll especially need to
specify your tokbox credentials.

Once that's done, you can do:

    make runserver

(which is equivalent to `NODE_ENV=dev make runserver`)


How to run the tests?
---------------------

    make test

Redis is the default backend. The code is made to support multiple ones but
only supports redis for now.

In order to have tests working with Mac OS, make sure your ulimit
value is high enough or you will get EMFILE errors:

    ulimit -S -n 2048

Where to report bugs?
---------------------

You should report bugs/issues or feature requests via [the loop-server bugzilla
component](https://bugzilla.mozilla.org/enter_bug.cgi?product=Loop&component=Server)


Estimate Redis Memory Usage
---------------------------

To estimate redis usage, checkout the repository and run the `redis_usage.py`
file:

    ./redis_usage.py [users] [daily-calls] [monthly-revocation]

For instance (for 2M users and 10 calls per day per user)

    $ ./redis_usage.py 2000000 10

    loop-server: v0.6.0-DEV
    Usage for 2000000 users, with 10 daily calls per user and 0 monthly
    revocations is 26569 MBytes

The biggest AWS Elasticache Redis virtual machine is 68GB large so if we want
to handle more that 150M users we will probably want to do some sharding to
have one redis for calls and another one for user management.


License
-------

The Loop server code is released under the terms of the
[Mozilla Public License v2.0](http://www.mozilla.org/MPL/2.0/). See the
`LICENSE` file at the root of the repository.
