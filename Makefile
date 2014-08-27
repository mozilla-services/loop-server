# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

NODE_LOCAL_BIN=./node_modules/.bin

.PHONY: test
test: lint cover-mocha spaceleft

.PHONY: travis
travis: lint separate-tests loadtests-check

separate-tests:
	@env NODE_ENV=test ./node_modules/mocha/bin/mocha test/* --reporter spec -ig websocket
	@env NODE_ENV=test ./node_modules/mocha/bin/mocha test/* --reporter spec -g websocket -t 5000

install:
	@npm install

.PHONY: lint
lint: eslint

clean:
	rm -rf .venv node_modules coverage lib-cov html-report

.PHONY: cover-mocha
cover-mocha:
	@if [ `ulimit -n` -lt 1024 ]; then echo "ulimit is too low. Please run 'ulimit -S -n 2048' before running tests."; exit 1; fi
	@env NODE_ENV=test $(NODE_LOCAL_BIN)/istanbul cover \
			 $(NODE_LOCAL_BIN)/_mocha -- --reporter spec -t 5000 test/*
	@echo aim your browser at coverage/lcov-report/index.html for details

.PHONY: eslint
eslint:
	@$(NODE_LOCAL_BIN)/eslint test/*.js loop/*.js loop/*/*.js

.PHONY: mocha
mocha:
	@if [ `ulimit -n` -lt 1024 ]; then echo "ulimit is too low. Please run 'ulimit -S -n 2048' before running tests."; exit 1; fi
	@env NODE_ENV=test ./node_modules/mocha/bin/mocha test/* --reporter spec

.PHONY: spaceleft
spaceleft:
	@if which grin 2>&1 >/dev/null; \
	then \
      test "$$(grin " $$" loop/ test/ config/ -l | wc -l)" -ne "0"  && \
	  grin -l " $$" loop/ test/ config/ | xargs sed -i 's/\s*$$//' || exit 0; \
	fi

.PHONY: runserver
runserver:
	@env NODE_ENV=${NODE_ENV} node loop/index.js

loadtests-check:
	@env NODE_ENV=loadtest node loop/index.js & PID=$$!; \
	  sleep 1 && cd loadtests && \
	  make test SERVER_URL=http://127.0.0.1:5000; \
	  EXIT_CODE=$$?; kill $$PID; exit $$EXIT_CODE

.PHONY: circus
circus:
	circusd circus/loop-server.ini
