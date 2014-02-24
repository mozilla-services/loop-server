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

    getOne: function(coll, query, cb) {
      _ensureStore(coll);
      var record = stores[coll].filter(function(record) {
        return Object.keys(query).some(function(field) {
          return record[field] === query[field];
        });
      }).shift();
      if (!record)
        return cb(new Error("No record found matching query"));
      cb(null, record);
    },

    drop: function(cb) {
      for (var name in this.stores)
        this.stores[name] = [];
      cb(null);
    }
  };
};
