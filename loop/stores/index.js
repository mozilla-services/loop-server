"use strict";

function getStore(conf, options) {
  options = options || {};
  var Store = require('./' + conf.engine + '.js');
  return new Store(conf.settings, options);
}

module.exports = {getStore: getStore};
