const unpersistedQueue = {};
let isUpdating = {};

export default (db, localId) => {
  const saveReducer = (reducerName, reducerState) => {
    if (isUpdating[reducerName]) {
      // enqueue promise
      unpersistedQueue[reducerName] = unpersistedQueue[reducerName] || [];
      unpersistedQueue[reducerName].push(reducerState);

      return Promise.resolve();
    }

    isUpdating[reducerName] = true;

    return db.get(reducerName).catch(err => {
      if (err.status === 404) {
        return {_id: reducerName};
      } else {
        throw err;
      }
    }).catch(err => {
      console.error(err);
    }).then(doc => {
      doc.localId = localId;
      doc.state = reducerState;
      return doc;
    }).then(doc => {
      return db.put(doc);
    }).then(() => {
      isUpdating[reducerName] = false;
      if (unpersistedQueue[reducerName] &&
          unpersistedQueue[reducerName].length > 0) {
        const next = unpersistedQueue[reducerName].shift();

        return saveReducer(reducerName, next);
      }
    }).catch(err => {
      console.error(err);
    });
  };

  return saveReducer;
};
