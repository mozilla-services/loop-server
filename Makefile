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
		./node_modules/mocha/bin/mocha test/* --reporter spec

.PHONY: runserver
runserver:
	@env NODE_ENV=${NODE_ENV} PORT=5000 SESSION_SECRET=${SESSION_SECRET} \
		node loop/index.js
