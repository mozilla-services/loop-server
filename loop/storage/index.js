module.exports = function Storage(adapter) {
  if (!adapter)
    throw new Error("Invalid adapter provided");

  return {
    addSimplepushUrl: function(userid, url, cb) {
      adapter.addOne("simplepush_urls", {
        userid: userid,
        url: url
      }, cb);
    },

    getSimplepushUrl: function(userid, cb) {
      adapter.getOne("simplepush_urls", {
        userid: userid
      }, cb);
    },

    addCallInfo: function(userid, token, session, cb) {
      adapter.addOne("call_info", {
        userid: userid,
        token: token,
        session: session
      }, cb);
    },

    getCallInfo: function(userid, cb) {
      adapter.getOne("call_info", {
        userid: userid
      }, cb);
    }
  };
};
