module.exports = function Storage(adapter) {
  if (!adapter)
    throw new Error("Invalid adapter provided");

  return {
    /**
     * Adds a simplepush url record to the database.
     * @param {String}   userid User id
     * @param {String}   url    Simplepush URL
     * @param {Function} cb     Callback(err, record)
     */
    addSimplepushUrl: function(userid, url, cb) {
      adapter.addOne("simplepush_urls", {
        userid: userid,
        url: url
      }, cb);
    },

    /**
     * Retrieves a simplepush url record out of a userid.
     * @param  {String}   userid User id
     * @param  {Function} cb     Callback(err, record)
     */
    getSimplepushUrl: function(userid, cb) {
      adapter.getOne("simplepush_urls", {
        userid: userid
      }, cb);
    },

    /**
     * Adds a call info record to the database.
     * @param {String}   userid   User id
     * @param {String}   token    Token
     * @param {String}   session  Session identifier
     * @param {Function} cb       Callback(err, record)
     */
    addCallInfo: function(userid, token, session, cb) {
      adapter.addOne("call_info", {
        userid: userid,
        token: token,
        session: session
      }, cb);
    },

    /**
     * Retrieves a call info record out of a userid.
     * @param  {String}   userid User id
     * @param  {Function} cb     Callback(err, record)
     */
    getCallInfo: function(userid, cb) {
      adapter.getOne("call_info", {
        userid: userid
      }, cb);
    }
  };
};
