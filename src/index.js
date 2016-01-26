import equal from 'deep-equal';
import save from './save.js';

const REINIT = 'redux-pouchdb-plus/REINIT';
const INIT = 'redux-pouchdb-plus/INIT';
const SET_REDUCER = 'redux-pouchdb-plus/SET_REDUCER';

export function reinit(reducerName) {
  return {type: REINIT, reducerName}
}

export const persistentStore = (storeOptions={}) => createStore => (reducer, initialState) => {
  const store = createStore(reducer, initialState);

  store.dispatch({
    type: INIT,
    store,
    storeOptions
  });

  return store;
}

export const persistentReducer = (reducer, reducerOptions={}) => {
  let isInitialized = false;
  let initialState;
  let store;
  let storeOptions;
  let changes;
  let saveReducer;
  let currentState;

  function reinitReducer(state) {
    if (changes) changes.cancel();

    let db = reducerOptions.db || storeOptions.db;
    if (!db) throw 'No db connector provided. ' +
      'You must at least provide one to the store or the reducer.';

    if (db instanceof Function)
      db = db(reducer.name, store);

    saveReducer = save(db);

    db.get(reducer.name).then(doc => {
      setReducer(doc);
    }).catch(err => {
      if (err.status === 404)
        return saveReducer(reducer.name, state);
      else
        throw err;
    }).then(() => {
      isInitialized = true;

      return changes = db.changes({
        include_docs: true,
        live: true,
        since: 'now',
        doc_ids: [reducer.name]
      }).on('change', change => {
        if (!change.doc.state)
          saveReducer(change.doc._id, currentState);
        else if (!equal(change.doc.state, currentState))
          setReducer(change.doc);
      });
    }).catch(err => {
      console.error(err);
    });
  }

  function setReducer(doc) {
    const { _id, _rev, state } = doc;

    store.dispatch({
      type: SET_REDUCER,
      reducer: _id,
      state,
      _rev
    });
  };

  return (state, action) => {
    switch (action.type) {
      case INIT:
        store = action.store;
        storeOptions = action.storeOptions;
      case REINIT:
        if (!action.reducerName || action.reducerName === reducer.name) {
          reinitReducer(initialState);
          return currentState = initialState;
        }
        else return state;
      case SET_REDUCER:
        if (action.reducer === reducer.name && action.state)
          return currentState = reducer(action.state, action);
      default:
        const nextState = reducer(state, action);
        if (!initialState) initialState = nextState;
        if (isInitialized && !equal(nextState, currentState)) {
          saveReducer(reducer.name, nextState);
        }

        return currentState = nextState;
    }
  }
}
