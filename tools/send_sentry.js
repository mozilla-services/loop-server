var args = process.argv.slice(2);

if (args.indexOf('--help') >= 0) {
  console.log("USAGE: " + process.argv.slice(0, 2).join(' ') + " [MESSAGE]");
  process.exit(0);
}

var conf = require('../loop/config').conf;
var raven = require('raven');

var message = args[0] || 'Server is able to communicate with Sentry';

var ravenClient = new raven.Client(conf.get('sentryDSN'));
ravenClient.on('logged', function(){
  console.log('OK');
});
ravenClient.on('error', function(e){
  console.log('KO', e);
});

ravenClient.captureMessage(message, {level: 'info'});
