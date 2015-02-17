var conf = require('./config').conf.get('newRelic');

exports.config = {
  app_name: [conf.appName],
  license_key: conf.licenceKey,
  logging: {
    level: conf.loggingLevel
  }
};
