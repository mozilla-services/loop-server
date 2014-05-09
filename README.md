Loop server
===========

This is the server part of the loop project. You can find more information on
its APIs by looking at [the online documentation](https://docs.services.mozilla.com/loop/)

Estimate Redis Memory Usage
---------------------------

    usage = nbUsers * 280 + nbCallsPerDay * 1365 + nbUrlRevocationPerMonth * 150 + 600000 (bytes)

 - For 10M users and 100 000 calls a day we will need around 2.7 GB
 - For 250M users and 10M calls a day we will need around 78 GB

The biggest AWS Elasticache Redis virtual machine is 68GB large so if we want to handle more that 150M users we will probably want to do some sharding to have one redis for calls and another one for user management.


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

`dev` is the environment by default.

    make runserver

this is equivalent to:

    NODE_ENV=dev make runserver


How to run the tests?
---------------------

    make test

Redis is the default backend, but you could use another one (MongoDB, Memory).

All three are tested with `make test` so you will need a local mongodb
server to test the MongoDB backend.

To install mongodb:

### Linux

    apt-get install mongodb-server

### MacOS

    brew install mongo
    ln -sfv /usr/local/opt/mongodb/*.plist ~/Library/LaunchAgents
    launchctl load ~/Library/LaunchAgents/homebrew.mxcl.mongodb.plist

Where to report bugs?
---------------------

You should report bugs/issues or feature requests via [the loop-server bugzilla
component](https://bugzilla.mozilla.org/enter_bug.cgi?product=Loop&component=Server)

License
-------

The Loop server code is released under the terms of the
[Mozilla Public License v2.0](http://www.mozilla.org/MPL/2.0/). See the
`LICENSE` file at the root of the repository.
