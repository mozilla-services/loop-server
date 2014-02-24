module.exports = function MemoryStorage() {
  var simplepushUrls = [],
      callInfo       = [];

  return {
    addSimplepushUrl: function(userid, simplepush_url, cb) {
      var record = {userid: userid, simplepush_url: simplepush_url};
      var exists = this.getSimplepushUrls(userid, function(err, records) {
        var exists = records.some(function(record) {
          return record.simplepush_url === simplepush_url;
        });
        if (exists)
          return cb(new Error("Duplicate entry"));
        simplepushUrls.push(record);
        cb(null, record);
      });
    },

    getSimplepushUrls: function(userid, cb) {
      var records = simplepushUrls.filter(function(record) {
        return record.userid === userid;
      });
      cb(null, records);
    },

    addCallInfo: function(userid, token, session, cb) {
      var record = {userid: userid, token: token, session: session};
      callInfo.push(record);
      cb(null, record);
    },

    getCallInfo: function(userid, cb) {
      var record = callInfo.filter(function(record) {
        return record.userid === userid;
      }).shift();
      cb(null, record);
    },

    /**
     * Drops current database.
     * @param  {Function} cb Callback(err)
     */
    drop: function(cb) {
      simplepushUrls = [];
      callInfo       = [];
      cb(null);
    }
  };
};
