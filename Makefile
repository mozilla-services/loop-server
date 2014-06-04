# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

NODE_LOCAL_BIN=./node_modules/.bin

.PHONY: test
test: lint cover-mocha

install:
	@npm install

.PHONY: lint
lint: jshint

clean:
	rm -rf .venv node_modules coverage lib-cov html-report

.PHONY: cover-mocha
cover-mocha:
	@env NODE_ENV=test $(NODE_LOCAL_BIN)/istanbul cover \
			 $(NODE_LOCAL_BIN)/_mocha -- --reporter spec test/*
	@echo aim your browser at coverage/lcov-report/index.html for details

.PHONY: jshint
jshint:
	@$(NODE_LOCAL_BIN)/jshint test loop/*.js

.PHONY: eslint
eslint:
	@$(NODE_LOCAL_BIN)/eslint **/*.js

.PHONY: mocha
mocha:
	@env NODE_ENV=test ./node_modules/mocha/bin/mocha test/* --reporter spec

.PHONY: runserver
runserver:
	@env NODE_ENV=${NODE_ENV} PORT=5000 \
		node loop/index.js
