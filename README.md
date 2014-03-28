Loop server
===========

This is the server part of the loop project.

It exposes the following APIs:

    # A "*" means this URI requires authentication (you should pass a valid
    # BrowserID assertion).

    * POST /registration/  →  Associates a Simple Push Endpoint (URL)
                              with the authenticated user.
                              (Requires a "simple_push_url" parameter.)

    * POST /call-url/      →  Create the call url a callee can click on.
                              (Requires "remote_id" and "valid_duration"
                              parameters).

      GET  /calls/{token}  →  Get the app (that's the url in question, which
                              displays an app)
                              (No parameter required.)

      POST /calls/{token}  →  Add an incoming call (does a simple push notif
                              and gets room tokens), return participant tokens.
                              (Requires "nickname" parameter)

    * GET  /calls/         →  List incoming calls for the authenticated user.
                              (Requires a "version" parameter).


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

License
-------

The Loop server code is released under the terms of the
[Mozilla Public License v2.0](http://www.mozilla.org/MPL/2.0/). See the
`LICENSE` file at the root of the repository.

