import uuid from 'uuid';
import equalDeep from 'lodash.isequal';
import cloneDeep from 'lodash.clonedeep';
import save from './save.js';

export { inSync } from './save.js';

// A client hash to filter out local database changes (as those
// may lead to several race conditions).
// see also http://stackoverflow.com/questions/28280276/changes-filter-only-changes-from-other-db-instances
const CLIENT_HASH = uuid.v1();

const REINIT = '@@redux-pouchdb-plus/REINIT';
const INIT = '@@redux-pouchdb-plus/INIT';
const SET_REDUCER = '@@redux-pouchdb-plus/SET_REDUCER';

export const PAUSE_SAVING  = '@@redux-pouchdb-plus/PAUSE_SAVING';
export const RESUME_SAVING = '@@redux-pouchdb-plus/RESUME_SAVING';

const allReducers = [];

export function reinit(reducerName) {
  if(reducerName && allReducers.indexOf(reducerName) === -1)
    throw TypeError('Invalid persistent reducer to reinit: ' + reducerName);

  return {type: REINIT, reducerName};
}

export const persistentStore = (storeOptions={}) => createStore => (reducer, initialState) => {
  const store = createStore(reducer, initialState);
  const initializedReducers = {};

  store.dispatch({
    type: INIT,
    store,
    storeOptions,
    initializedReducers
  });

  return store;
};

export const persistentReducer = (reducer, reducerOptions={}) => {
  let initialState;
  let store;
  let storeOptions;
  let initializedReducers = {};
  let changes;
  let saveReducer;
  let currentState;
  let name = reducerOptions.name ? reducerOptions.name : reducer.name;
  let paused = false;

  initializedReducers[name] = false;

  // call the provide (store only) callback as soon
  // as all persistent reducers are initialized
  function onReady() {
    if (storeOptions.onReady instanceof Function)
      storeOptions.onReady.call(null, store);
  }

  // call the provided callbacks as soon as this reducer
  // was initialized (loaded from or saved to the db)
  function onInit(state) {
    if (reducerOptions.onInit instanceof Function)
      reducerOptions.onInit.call(null, name, state, store);
    if (storeOptions.onInit instanceof Function)
      storeOptions.onInit.call(null, name, state, store);
  }

  // call the provided callbacks when this reducer
  // was updated with data from the db
  function onUpdate(state) {
    if (reducerOptions.onUpdate instanceof Function)
      reducerOptions.onUpdate.call(null, name, state, store);
    if (storeOptions.onUpdate instanceof Function)
      storeOptions.onUpdate.call(null, name, state, store);
  }

  // call the provided callbacks when the state
  // of this reducer was saved to the db
  function onSave(state) {
    if (reducerOptions.onSave instanceof Function)
      reducerOptions.onSave.call(null, name, state, store);
    if (storeOptions.onSave instanceof Function)
      storeOptions.onSave.call(null, name, state, store);
  }

  // get the current db connector an initialize the state of this
  // reducer by loading it from the db or by saving it
  // to the db (if it is not already persisted there)
  function reinitReducer(state) {
    if (changes) changes.cancel();

    let db = reducerOptions.db || storeOptions.db;
    if (!db) throw TypeError('No db connector provided. ' +
      'You must at least provide one to the store or the reducer.');

    if (db instanceof Function)
      db = db(name, store);

    saveReducer = save(db, CLIENT_HASH);

    db.get(name).then(doc => {
      // set reducer state if there was an entry found in the db
      setReducer(doc);
    }).catch(err => {
      // save the reducer state if there was no entry in the db
      if (err.status === 404)
        return saveReducer(name, toPouch(state)).then(() => {
          onSave(state);
        });
      else
        throw err;
    }).then(() => {
      // from here on the reducer was loaded from db or saved to db
      initializedReducers[name] = true;
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
        doc_ids: [name]
      }).on('change', change => {
        if (change.doc.localId !== CLIENT_HASH) {
          if (!change.doc.state)
            saveReducer(change.doc._id, toPouch(currentState)).then(() => {
              onSave(currentState);
            });
          else if (!isEqual(fromPouch(change.doc.state), currentState))
            setReducer(change.doc);
        }
      });
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
  }

  function toPouch(x) {
    if (reducerOptions.toPouch instanceof Function)
      return reducerOptions.toPouch.call(null, x)
    else
      return cloneDeep(x);
  }
  function fromPouch(x) {
    if (reducerOptions.fromPouch instanceof Function)
      return reducerOptions.fromPouch.call(null, x)
    else
      return cloneDeep(x);
  }
  function isEqual(x, y) {
    if (reducerOptions.isEqual instanceof Function)
      return reducerOptions.isEqual.call(null, x, y)
    else
      return equalDeep(x, y);
  }

   const reduceAndMaybeSave = (state,action) => {
        const nextState = reducer(state, action);

        if (!initialState) {
          initialState = nextState;
        }

        const isInitialized = initializedReducers[name];
        if (isInitialized && !paused && !isEqual(nextState, currentState)) {
          currentState = nextState;
          saveReducer(name, toPouch(currentState)).then(() => {
            onSave(currentState);
          });
        }
        else currentState = nextState;

        return currentState;
   };

  // the proxy function that wraps the real reducer
  const proxyReducer = (state, action) => {
    switch (action.type) {
      
      case INIT:
        store = action.store;
        storeOptions = action.storeOptions;
        initializedReducers = action.initializedReducers;
        if (initializedReducers.hasOwnProperty(name))
          throw Error('Duplicate reducer of name ' + name + ' in the same store');
        initializedReducers[name] = false;
        allReducers.push(name);
        // falls through

      case REINIT:
        if (!action.reducerName || action.reducerName === name) {
          initializedReducers[name] = false;
          reinitReducer(initialState);
          return currentState = initialState;
        }
        else return state;

      case SET_REDUCER:
        if (action.reducer === name && action.state) {
          currentState = reducer(action.state, action);
          onUpdate(currentState);
          return currentState;
        }
        // falls through

      default: 
        return reduceAndMaybeSave(state,action);
    }
  };

  proxyReducer.getName = () => {
    return name;
  };

  return proxyReducer;
};
