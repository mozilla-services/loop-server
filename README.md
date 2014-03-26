Loop server
===========

This is the server part of the loop project. You can find more information on
its APIs by looking at [the online documentation](https://docs.services.mozilla.com/loop/)

How to install?
---------------

You will need mongodb installed:

### Linux

    apt-get install mongodb-server

### OS X

Assuming you have brew installed, use it to install mongodb; then configure
your account to run it:

    brew install mongo
    ln -sfv /usr/local/opt/mongodb/*.plist ~/Library/LaunchAgents
    launchctl load ~/Library/LaunchAgents/homebrew.mxcl.mongodb.plist

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

