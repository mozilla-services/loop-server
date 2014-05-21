install:
	virtualenv .
	bin/pip install git+git://github.com/mozilla-services/loads.git
load:
	bin/loads-runner loadtest.TestLoop.test_all
