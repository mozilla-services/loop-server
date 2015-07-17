SERVER_URL = https://loop.stage.mozaws.net:443
SIMPLE_PUSH_URL = https://call.stage.mozaws.net/

# Hackety-hack around OSX system python bustage.
# The need for this should go away with a future osx/xcode update.
ARCHFLAGS = -Wno-error=unused-command-line-argument-hard-error-in-future
INSTALL = ARCHFLAGS=$(ARCHFLAGS) ./venv/bin/pip install

.PHONY: install clean bench megabench

# Build virtualenv, to ensure we have all the dependencies.
.env.install:
	virtualenv ./venv
	$(INSTALL) pexpect >> loadtest.log && \
	$(INSTALL) configparser==3.3.0post2 >> loadtest.log && \
	$(INSTALL) gevent >> loadtest.log && \
	$(INSTALL) git+git://github.com/mozilla-services/loads.git  >> loadtest.log && \
	$(INSTALL) git+git://github.com/mozilla-services/requests-hawk.git >> loadtest.log && \
	rm loadtest.log || cat loadtest.log
	touch $@

install: .env.install

# Clean all the things installed by `make build`.
clean:
	rm -rf ./venv *.pyc .env.install

# Run a single test from the venv machine, for sanity-checking.
test: install
	SIMPLE_PUSH_URL=$(SIMPLE_PUSH_URL) ./venv/bin/loads-runner --config=./config/test.ini --server-url=$(SERVER_URL) loadtest.TestLoop.test_http_calls
	SIMPLE_PUSH_URL=$(SIMPLE_PUSH_URL) ./venv/bin/loads-runner --config=./config/test.ini --server-url=$(SERVER_URL) loadtest.TestLoop.test_websockets

# Run a bench of 20 concurrent users.
bench:
	SIMPLE_PUSH_URL=$(SIMPLE_PUSH_URL) ./venv/bin/loads-runner --config=./config/bench.ini --server-url=$(SERVER_URL) loadtest.TestLoop.test_all

# Run a much bigger bench, by submitting to broker in AWS.
megabench:
	./venv/bin/loads-runner --config=./config/megabench.ini --user-id=$(USER) --server-url=$(SERVER_URL) loadtest.TestLoop.test_all
#	./venv/bin/loads-runner --config=./config/megabench.ini --user-id=$(USER) --server-url=$(SERVER_URL) loadtest.TestLoop.test_websockets

smoke:
	./venv/bin/loads-runner --config=./config/smoke.ini --user-id=$(USER) --server-url=$(SERVER_URL) loadtest.TestLoop.test_all

# Purge any currently-running loadtest runs.
purge:
	./venv/bin/loads-runner --config=./config/megabench.ini --purge-broker

attach:
	./venv/bin/loads-runner --config=./config/megabench.ini --attach

travis:
	loads-runner --config=./config/test.ini --server-url=$(SERVER_URL) loadtest.TestLoop.test_all
