var PubSub = require('./pubsub');


var Notifications = function(pubsub) {
  this.observers = {};
  this.pubsub = pubsub;
  this.setupObservers();
}

Notifications.prototype = {
  /**
   * Setup the pub/sub on redis expire keys.
   *
   * On each expire notification, trigger the appropriate observers.
   **/
  setupObservers: function() {
    var self = this;

    self.pubsub.on("pmessage", function(pattern, channel, key) {
      console.log("Something EXPIRED");
      Object.keys(self.observers).forEach(function(prefix) {
        if (key.indexOf(prefix) === 0) {
          self.observers[prefix](key);
        }
      })
    });

    self.pubsub.psubscribe("__keyevent*__:expired");
  },

  /**
   * Register a new observer.
   *
   * When a key expires, if it matches the given prefix, the given callback
   * will be triggered.
   **/
  on: function(prefix, callback) {
    this.observers[prefix] = callback;
  }

}

module.exports = Notifications;
