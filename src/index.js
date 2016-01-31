import equal from 'deep-equal';
import Immutable from 'immutable';
import save from './save.js';

const REINIT = 'redux-pouchdb-plus/REINIT';
const INIT = 'redux-pouchdb-plus/INIT';
const SET_REDUCER = 'redux-pouchdb-plus/SET_REDUCER';

const initializedReducers = {};

export function reinit(reducerName) {
  const reducerNames = Object.keys(initializedReducers);

  if (!reducerName) { // reinit all reducers
    for (let n of reducerNames) {
      initializedReducers[n] = false;
    }
  }
  else { // reinit a specific reducer
    if (reducerNames.indexOf(reducerName) === -1)
      throw 'Invalid persistent reducer to reinit: ' + reducerName;

    initializedReducers[reducerName] = false;
  }

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
  let initialState;
  let immutable;
  let store;
  let storeOptions;
  let changes;
  let saveReducer;
  let currentState;

  initializedReducers[reducer.name] = false;

  // call the provide (store only) callback as soon
  // as all persistent reducers are initialized
  function onReady() {
    if (storeOptions.onReady instanceof Function)
      storeOptions.onReady.call(store, store.dispatch);
  }

  // call the provided callbacks as soon as this reducer
  // was initialized (loaded from or saved to the db)
  function onInit(state) {
    if (reducerOptions.onInit instanceof Function)
      reducerOptions.onInit.call(reducer, reducer.name, state, store.dispatch);
    if (storeOptions.onInit instanceof Function)
      storeOptions.onInit.call(reducer, reducer.name, state, store.dispatch);
  }

  // call the provided callbacks when this reducer
  // was updated with data from the db
  function onUpdate(state) {
    if (reducerOptions.onUpdate instanceof Function)
      reducerOptions.onUpdate.call(reducer, reducer.name, state, store.dispatch);
    if (storeOptions.onUpdate instanceof Function)
      storeOptions.onUpdate.call(reducer, reducer.name, state, store.dispatch);
  }

  // call the provided callbacks when the state
  // of this reducer was saved to the db
  function onSave(state) {
    if (reducerOptions.onSave instanceof Function)
      reducerOptions.onSave.call(reducer, reducer.name, state, store.dispatch);
    if (storeOptions.onSave instanceof Function)
      storeOptions.onSave.call(reducer, reducer.name, state, store.dispatch);
  }

  // get the current db connector an initialize the state of this
  // reducer by loading it from the db or by saving it
  // to the db (if it is not already persisted there)
  function reinitReducer(state) {
    if (changes) changes.cancel();

    let db = reducerOptions.db || storeOptions.db;
    if (!db) throw 'No db connector provided. ' +
      'You must at least provide one to the store or the reducer.';

    if (db instanceof Function)
      db = db(reducer.name, store);

    saveReducer = save(db);

    db.get(reducer.name).then(doc => {
      // set reducer state if there was an entry found in the db
      setReducer(doc);
    }).catch(err => {
      // save the reducer state if there was no entry in the db
      if (err.status === 404)
        return saveReducer(reducer.name, toPouch(state)).then(() => {
          onSave(state);
        });
      else
        throw err;
    }).then(() => {
      // from here on the reducer was loaded from db or saved to db
      initializedReducers[reducer.name] = true;
      onInit(currentState);

      let ready = true;
      for (let reducerName of Object.keys(initializedReducers)) {
        if (!initializedReducers[reducerName]) {
          ready = false;
          break;
        }
      }
      if (ready) onReady();

      // listen to changes in the db (e.g. when a replication occurs)
      // and update the reducer state when it happens
      return changes = db.changes({
        include_docs: true,
        live: true,
        since: 'now',
        doc_ids: [reducer.name]
      }).on('change', change => {
        if (!change.doc.state)
          saveReducer(change.doc._id, toPouch(currentState)).then(() => {
            onSave(currentState);
          });
        else if (!isEqual(change.doc.state, currentState))
          setReducer(change.doc);
      });
    }).catch(err => {
      console.error(err);
    });
  }

  // an action to update the current reducer state (used when
  // the state was fetched from the db)
  function setReducer(doc) {
    const { _id, _rev, state } = doc;
    const _state = fromPouch(state);

    store.dispatch({
      type: SET_REDUCER,
      reducer: _id,
      state: _state,
      _rev
    });
  };

  // Support functions for Immutable js.
  // Immutable.toJS and Immutable.fromJS don't support
  // a mixture of immutable and plain js data.
  // transit-immutable-js would be another option that
  // also would handle this mixture.
  // Unfortunately it serializes to a bit
  // cryptic JSON string that is not so nice to save
  // in PouchDB.
  function isImmutable(x) {
    return Immutable.Iterable.isIterable(x);
  }
  function toPouch(x) {
    if (immutable)
      return x.toJS();
    else
      return x;
  }
  function fromPouch(x) {
    if (immutable)
      return Immutable.fromJS(x);
    else
      return x;
  }
  function isEqual(x, y) {
    if (immutable)
      return Immutable.is(x, y);
    else
      return equal(x, y);
  }

  // the proxy function that wraps the real reducer
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
        if (action.reducer === reducer.name && action.state) {
          currentState = reducer(action.state, action);
          onUpdate(currentState);
          return currentState
        }
      default:
        const nextState = reducer(state, action);

        if (!initialState) {
          initialState = nextState;
          immutable = isImmutable(initialState);
        }

        const isInitialized = initializedReducers[reducer.name];
        if (isInitialized && !isEqual(nextState, currentState)) {
          saveReducer(reducer.name, toPouch(nextState)).then(() => {
            onSave(nextState);
          });
        }

        return currentState = nextState;
    }
  }
}
