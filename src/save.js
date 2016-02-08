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
      // TODO use object spread operator when standardized
      // (see https://github.com/vicentedealencar/redux-pouchdb/issues/5)
      const newDoc = Object.assign({}, doc);
      newDoc.localId = localId;

      if (Array.isArray(reducerState)) {
        newDoc.state = [
          ...(doc.state || []),
          ...reducerState
        ];
      } else {
        // TODO use object spread operator when standardized
        // (see https://github.com/vicentedealencar/redux-pouchdb/issues/5)
        newDoc.state = Object.assign({}, doc.state, reducerState);
      }

      return newDoc;
    }).then(newDoc => {
      return db.put(newDoc);
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
