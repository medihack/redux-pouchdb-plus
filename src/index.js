import uuid from 'uuid';
import equalDeep from 'lodash.isequal';
import cloneDeep from 'lodash.clonedeep';
import Immutable from 'immutable';
import transit from 'transit-immutable-js';
import save from './save.js';

export { inSync } from './save.js';

// A client hash to filter out local database changes (as those
// may lead to several race conditions).
// see also http://stackoverflow.com/questions/28280276/changes-filter-only-changes-from-other-db-instances
const CLIENT_HASH = uuid.v1();

const REINIT = '@@redux-pouchdb-plus/REINIT';
const INIT = '@@redux-pouchdb-plus/INIT';
const SET_REDUCER = '@@redux-pouchdb-plus/SET_REDUCER';

const allReducers = []

export function reinit(reducerName) {
  if(reducerName && allReducers.indexOf(reducerName) === -1)
    throw 'Invalid persistent reducer to reinit: ' + reducerName;

  return {type: REINIT, reducerName}
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
}

export const persistentReducer = (reducer, reducerOptions={}) => {
  let initialState;
  let immutable;
  let store;
  let storeOptions;
  let initializedReducers = {};
  let changes;
  let saveReducer;
  let currentState;
  let name = reducerOptions.name ? reducerOptions.name : reducer.name;

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
    if (!db) throw 'No db connector provided. ' +
      'You must at least provide one to the store or the reducer.';

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
      return JSON.parse(transit.toJSON(x));
    else
      return cloneDeep(x);
  }
  function fromPouch(x) {
    if (immutable)
      return transit.fromJSON(JSON.stringify(x));
    else
      return cloneDeep(x);
  }
  function isEqual(x, y) {
    if (immutable)
      return Immutable.is(x, y);
    else
      return equalDeep(x, y);
  }

  // the proxy function that wraps the real reducer
  const proxyReducer = (state, action) => {
    switch (action.type) {
      case INIT:
        store = action.store;
        storeOptions = action.storeOptions;
        initializedReducers = action.initializedReducers;
        if(initializedReducers.hasOwnProperty(name))
          throw 'Duplicate reducer of name ' + name + ' in the same store';
        initializedReducers[name] = false;
        allReducers.push(name);
      case REINIT:
        if (!action.reducerName || action.reducerName === name) {
          initializedReducers[name] = false
          reinitReducer(initialState);
          return currentState = initialState;
        }
        else return state;
      case SET_REDUCER:
        if (action.reducer === name && action.state) {
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

        const isInitialized = initializedReducers[name];
        if (isInitialized && !isEqual(nextState, currentState)) {
          currentState = nextState;
          saveReducer(name, toPouch(currentState)).then(() => {
            onSave(currentState);
          });
        }
        else currentState = nextState;

        return currentState;
    }
  }
  proxyReducer.getName = () => {
    return name;
  }
  return proxyReducer
}
