# Loop server

[![Build Status](https://travis-ci.org/mozilla-services/loop-server.svg?branch=master)](https://travis-ci.org/mozilla-services/loop-server)

This is the server part of the Loop project. You can find more information on
its APIs by looking at [the online documentation](https://docs.services.mozilla.com/loop/)

## How do I install loop server?

You will need [Redis](http://redis.io/) server installed:

### Linux

```sh
apt-get install redis-server
```

or

```sh
yum install redis
```

### OS X

Assuming you have [brew](http://brew.sh/) installed, use it to install Redis:

```sh
brew install redis
```

If you need to restart it (after configuration update):

```sh
brew services restart redis
```

### All Platforms

Then clone the Loop server and install its dependencies:

```sh
git clone https://github.com/mozilla/loop-server.git
cd loop-server && make install
```

## How do I run it?

You can create your configuration file in `config/{NODE_ENV}.json`

`dev` is the environment by default. In order to run the server, you'll need to
create a `dev.json` file in the config folder. You can do so by using this
command:

```sh
cp config/{sample,dev}.json
```

Be sure to edit the content of `config/dev.json`. You'll especially need to
specify your [TokBox](http://tokbox.com/) credentials.

Once that's done, you can do:

```sh
make runserver
```

(which is equivalent to `NODE_ENV=dev make runserver`)

## How do I run the tests?

```sh
make test
```

Redis is the default backend. The code is made to support multiple ones but
only supports Redis for now.

In order to have tests working with Mac OS, make sure your `ulimit`
value is high enough or you will get EMFILE errors:

```sh
ulimit -S -n 2048
```

## How do I run the loadtests?

The loadtests are in the
[ailoads-loop](https://github.com/mozilla-services/ailoads-loop)
repository.

## Where do I report bugs?

You should report bugs/issues or feature requests via [the loop-server bugzilla
component](https://bugzilla.mozilla.org/enter_bug.cgi?product=Hello (Loop)&component=Server)

## How do I create the release "deploy to stage" bug?

1. Install [deploy-tix](https://github.com/rpappalax/deploy-tix)
2. Run it.

```sh
ticket -r mozilla -a loop-client -e stage -n 0.17.8 -z -u bugzilla_username -p bugzilla_password
```

## Estimate Redis Memory Usage

To estimate Redis usage, checkout the repository and run the `redis_usage.py`
file:

```sh
./redis_usage.py [users] [daily-calls] [monthly-revocation]
```

For instance (for 2M users and 10 calls per day per user)

```sh
$ ./redis_usage.py 2000000 10

loop-server: v0.6.0-DEV
Usage for 2000000 users, with 10 daily calls per user and 0 monthly
revocations is 26569 MBytes
```

The biggest AWS ElastiCache Redis virtual machine is 68GB large so if we want
to handle more that 150M users we will probably want to do some sharding to
have one Redis for calls and another one for user management.

## License

The Loop server code is released under the terms of the
[Mozilla Public License v2.0](http://www.mozilla.org/MPL/2.0/). See the
[`LICENSE`](LICENSE) file at the root of the repository.
