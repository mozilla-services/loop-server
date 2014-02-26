# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

NODE_LOCAL_BIN=./node_modules/.bin

.PHONY: test
test: lint mocha

install:
	@npm install

.PHONY: lint
lint: jshint

clean:
	rm -rf .venv node_modules

.PHONY: jshint
jshint:
	@$(NODE_LOCAL_BIN)/jshint test loop/*.js

.PHONY: mocha
mocha:
	@env NODE_ENV=test SESSION_SECRET=${SESSION_SECRET} \
		./node_modules/mocha/bin/mocha --reporter spec

.PHONY: runserver
runserver:
	@env NODE_ENV=${NODE_ENV} PORT=5000 SESSION_SECRET=${SESSION_SECRET} \
		node loop/index.js
