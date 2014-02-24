module.exports = function MemoryAdapter() {
  var stores = {};

  function _ensureStore(coll) {
    if (!stores.hasOwnProperty(coll))
      stores[coll] = [];
  }

  return {
    addOne: function(coll, record, cb) {
      _ensureStore(coll);
      stores[coll].push(record);
      cb(null, record);
    },

    getOne: function(coll, id, cb) {
      _ensureStore(coll);
      var record = stores[coll].filter(function(record) {
        return record.id === id;
      }).shift();
      // XXX error when not found?
      cb(null, record);
    }
  };
};
