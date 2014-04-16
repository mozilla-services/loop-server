Loop server
===========

This is the server part of the loop project. You can find more information on
its APIs by looking at [the online documentation](https://docs.services.mozilla.com/loop/)

How to install?
---------------

You will need redis-server installed:

### Linux

    apt-get install redis-server

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

`development` is the environment by default.

    make runserver

this is equivalent to:

    NODE_ENV=development make runserver


How to run the tests?
---------------------

    make test

Where to report bugs?
---------------------

You should report bugs/issues or feature requests via [the loop-server bugzilla
component](https://bugzilla.mozilla.org/enter_bug.cgi?product=Loop&component=Server)

License
-------

The Loop server code is released under the terms of the
[Mozilla Public License v2.0](http://www.mozilla.org/MPL/2.0/). See the
`LICENSE` file at the root of the repository.
