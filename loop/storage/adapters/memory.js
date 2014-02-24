module.exports = function MemoryAdapter() {
  var stores = {};

  /**
   * Ensures the adapter has a given named store set up. Creates it when not.
   * @private
   * @param  {Function} cb Callback(err, db)
   */
  function _ensureStore(coll) {
    if (!stores.hasOwnProperty(coll))
      stores[coll] = [];
  }

  return {
    /**
     * Adds a single record to the collection.
     * @param {String}   coll   Collection name
     * @param {Object}   record Record Object
     * @param {Function} cb     Callback(err, record)
     */
    addOne: function(coll, record, cb) {
      _ensureStore(coll);
      stores[coll].push(record);
      cb(null, record);
    },

    /**
     * Retrieves multiple records matching the provided query object.
     * @param  {String}   coll  Collection name
     * @param  {Object}   query Query object
     * @param  {Function} cb    Callback(err, records)
     */
    get: function(coll, query, cb) {
      _ensureStore(coll);
      var records = stores[coll].filter(function(record) {
        return Object.keys(query).some(function(field) {
          return record[field] === query[field];
        });
      });
      cb(null, records);
    },

    /**
     * Retrieves a single record matching the provided query object. Sends back
     * an error if no matching entry was found.
     * @param  {String}   coll  Collection name
     * @param  {Object}   query Query object
     * @param  {Function} cb    Callback(err, record)
     */
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

    /**
     * Drops current database.
     * @param  {Function} cb Callback(err)
     */
    drop: function(cb) {
      for (var name in this.stores)
        this.stores[name] = [];
      cb(null);
    }
  };
};
