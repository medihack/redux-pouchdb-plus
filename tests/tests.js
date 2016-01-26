import test from 'tape';
import { createStore, compose } from 'redux';
import PouchDB from 'pouchdb';
import timeout from 'timeout-then';
import Immutable from 'immutable';
import { persistentStore, persistentReducer, reinit } from '../src/index';

const INCREMENT = 'INCREMENT';
const DECREMENT = 'DECREMENT';

const setupPlainReducer = () => {
  const reducer = (state = {x: 5}, action) => {
    switch(action.type) {
      case INCREMENT:
        return { x: state.x + 1 };
      case DECREMENT:
        return { x: state.x - 1 };
      default:
        return state;
    }
  };
  return reducer;
}

const setupImmutableReducer = () => {
  const reducer = (state = Immutable.Map({x: 5}), action) => {
    switch(action.type) {
      case INCREMENT:
        return state.update('x', x => x + 1);
      case DECREMENT:
        return state.update('x', x => x - 1);
      default:
        return state;
    }
  };
  return reducer;
}

test('should persist store state with provided db connector', t => {
  const db = new PouchDB('testdb', {db : require('memdown')});
  const createPersistentStore = persistentStore({db})(createStore);
  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer);
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    t.equal(store.getState().x, 5);
    return db.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);
  }).then(() => {
    store.dispatch({
      type: INCREMENT
    });
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().x, 6);
    return db.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.end();
  });
});

test('should persist store state with provided db function', t => {
  const db1 = new PouchDB('testdb1', {db: require('memdown')});
  const db2 = new PouchDB('testdb2', {db: require('memdown')});

  let dbChoice = 1;
  const db = (reducerName, store) => {
    t.equal(reducerName, 'reducer');
    t.ok(store.getState());
    return dbChoice === 1 ? db1 : db2;
  }

  const createPersistentStore = persistentStore({db})(createStore);
  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer);
  const store = createPersistentStore(finalReducer);

  // use db 1
  timeout(500).then(() => {
    t.equal(store.getState().x, 5);
    return db1.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);
  }).then(() => {
    store.dispatch({
      type: INCREMENT
    });
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().x, 6);
    return db1.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);

  // use db 2
  }).then(() => {
    dbChoice = 2;
    store.dispatch(reinit());
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().x, 5);
    return db2.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);
  }).then(() => {
    store.dispatch({
      type: DECREMENT
    });
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().x, 4);
    return db2.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);

  // use db 1 again
  }).then(() => {
    dbChoice = 1;
    store.dispatch(reinit());
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().x, 6);
    return db1.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);

  // teardown
  }).then(() => {
    return db1.destroy();
  }).then(() => {
    return db2.destroy();
  }).then(() => {
    t.end();
  });
});

test('should prefer reducer db over store db', t => {
  const storeDb = new PouchDB('testdb1', {db : require('memdown')});
  const reducerDb = new PouchDB('testdb2', {db : require('memdown')});
  const createPersistentStore = persistentStore({db: storeDb})(createStore);
  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer, {db: reducerDb});
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    store.dispatch({
      type: INCREMENT
    });
    return timeout(500);
  }).then(() => {
    return reducerDb.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, 6);
  }).then(() => {
    return storeDb.get(reducer.name);
  }).catch(err => {
    // there should be no reducer document in store db
    // as it was never used
    t.equal(err.status, 404);
    return reducerDb.destroy();
  }).then(() => {
    t.end();
  });
});

test('should throw error if no db was provided', t => {
  const createPersistentStore = persistentStore()(createStore);
  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer);

  try {
    createPersistentStore(finalReducer);
  }
  catch(err) {
    t.ok(err.match(/No db connector provided/));
    t.end();
  }
});

test('should update reducer state when db was changed', t => {
  const db = new PouchDB('testdb', {db : require('memdown')});
  const createPersistentStore = persistentStore({db})(createStore);
  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer);
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    t.equal(store.getState().x, 5);
    return db.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);
    doc.state.x = 7;
    return db.put(doc);
  }).then(() => {
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().x, 7);
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.end();
  });
});

test('should work with immutable js data types', t => {
  const db = new PouchDB('testdb', {db : require('memdown')});
  const createPersistentStore = persistentStore({db, immutable: true})(createStore);
  const reducer = setupImmutableReducer();
  const finalReducer = persistentReducer(reducer);
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    t.equal(store.getState().get('x'), 5);
    return db.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().get('x'), doc.state.x);
  }).then(() => {
    store.dispatch({
      type: INCREMENT
    });
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().get('x'), 6);
    return db.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().get('x'), doc.state.x);
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.end();
  });
});

test('reducer immutable option should overwrite store immutable option', t => {
  const db = new PouchDB('testdb', {db : require('memdown')});
  const createPersistentStore = persistentStore({db, immutable: false})(createStore);
  const reducer = setupImmutableReducer();
  const finalReducer = persistentReducer(reducer, {immutable: true});
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    t.equal(store.getState().get('x'), 5);
    return db.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().get('x'), doc.state.x);
  }).then(() => {
    store.dispatch({
      type: INCREMENT
    });
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().get('x'), 6);
    return db.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().get('x'), doc.state.x);
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.end();
  });
});
