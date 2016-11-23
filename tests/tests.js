import test from 'tape';
import { createStore, compose } from 'redux';
import PouchDB from 'pouchdb';
import timeout from 'timeout-then';
import Immutable from 'immutable';
import transit from 'transit-immutable-js';
import uuid from 'uuid';
import { persistentStore, persistentReducer, reinit, inSync } from '../src/index';

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
  t.plan(5);

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
    t.ok(true);
  });
});

test('should persist store state with provided db function', t => {
  t.plan(5);

  const db = function() {
    return new PouchDB('testdb', {db : require('memdown')})
  };
  const createPersistentStore = persistentStore({db})(createStore);
  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer);
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    t.equal(store.getState().x, 5);
    return db().get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);
  }).then(() => {
    store.dispatch({
      type: INCREMENT
    });
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().x, 6);
    return db().get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);
  }).then(() => {
    return db().destroy();
  }).then(() => {
    t.ok(true);
  });
});


test('should handle a reinit action of multiple reducers correctly', t => {
  t.plan(17);

  const db1 = new PouchDB('testdb1', {db: require('memdown')});
  const db2 = new PouchDB('testdb2', {db: require('memdown')});

  let dbChoice = 1;
  // called 6 times cause of initial init and two reinits
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
    return Promise.all([db1.destroy(), db2.destroy()]);
  }).then(() => {
    t.ok(true);
  });
});

test('should handle a reinit with provided reducer name', t => {
  t.plan(3);

  const db = new PouchDB('testdb', {db : require('memdown')});
  const createPersistentStore = persistentStore({db})(createStore);
  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer);
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    store.dispatch(reinit('reducer'));
  }).then(() => {
    t.ok(true);
    store.dispatch(reinit('foo'));
  }).catch(() => {
    t.ok(true);
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.ok(true);
  });
});

test('should prefer reducer db over store db', t => {
  t.plan(3);

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
    t.ok(true);
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

test('should update reducer state when db was changed (simulates replication)', t => {
  t.plan(4);

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

    // simulate as if db change comes from another
    // source (like during a replication)
    doc.localId = uuid.v1();

    return db.put(doc);
  }).then(() => {
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().x, 7);
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.ok(true);
  });
});

test('should work with immutable js data types', t => {
  t.plan(5);

  const db = new PouchDB('testdb', {db : require('memdown')});
  const createPersistentStore = persistentStore({db})(createStore);
  const reducer = setupImmutableReducer();
  const finalReducer = persistentReducer(reducer);
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    t.equal(store.getState().get('x'), 5);
    return db.get(reducer.name);
  }).then(doc => {
    const immutableState = transit.fromJSON(JSON.stringify(doc.state));
    t.equal(store.getState().get('x'), immutableState.get('x'));
  }).then(() => {
    store.dispatch({
      type: INCREMENT
    });
    return timeout(500);
  }).then(() => {
    t.equal(store.getState().get('x'), 6);
    return db.get(reducer.name);
  }).then(doc => {
    const immutableState = transit.fromJSON(JSON.stringify(doc.state));
    t.equal(store.getState().get('x'), immutableState.get('x'));
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.ok(true);
  });
});

test('onReady callback should get called correctly', t => {
  t.plan(3);

  const db = new PouchDB('testdb', {db: require('memdown')});

  const createPersistentStore = persistentStore({
    onReady: function(store) {
      t.ok(store instanceof Object);
    }
  })(createStore);

  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer, {db: db});
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    store.dispatch(reinit());
    return timeout(500);
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.ok(true);
  });
});

test('onInit callback should get called correctly', t => {
  t.plan(9);

  const db = new PouchDB('testdb', {db: require('memdown')});

  const createPersistentStore = persistentStore({
    onInit: function(reducerName, reducerState, store) {
      t.equal(this, null);
      t.equal(reducerName, 'reducer');
      t.equal(reducerState.x, 5);
      t.equal(store.getState().x, 5);
    }
  })(createStore);

  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer, {db: db});
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    store.dispatch(reinit());
    return timeout(500);
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.ok(true);
  });
});

test('onUpdate callback should get called correctly', t => {
  t.plan(5);

  const db = new PouchDB('testdb', {db: require('memdown')});

  const createPersistentStore = persistentStore({
    onUpdate: function(reducerName, reducerState, store) {
      t.equal(this, null);
      t.equal(reducerName, 'reducer');
      t.equal(reducerState.x, 2);
      t.equal(store.getState().x, 5);
    }
  })(createStore);

  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer, {db: db});
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    return db.get(reducer.name);
  }).then(doc => {
    doc.state.x = 2;

    // simulate as if db change comes from another
    // source (like during a replication)
    doc.localId = uuid.v1();

    return db.put(doc);
  }).then(() => {
    return timeout(500);
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.ok(true);
  });
});

test('onSave callback should get called correctly', t => {
  t.plan(9);

  let callbackCounter = 0;

  const db = new PouchDB('testdb', {db: require('memdown')});

  const createPersistentStore = persistentStore({
    onSave: function(reducerName, reducerState, store) {
      t.equal(this, null);
      t.equal(reducerName, 'reducer');

      if (callbackCounter === 0) {
        t.equal(reducerState.x, 5);
        t.equal(store.getState().x, 5);
      }
      else {
        t.equal(reducerState.x, 6);
        t.equal(store.getState().x, 6);
      }

      callbackCounter++;
    }
  })(createStore);

  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer, {db: db});
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    store.dispatch({type: INCREMENT});
    return timeout(500);
  }).then(() => {
    return db.destroy();
  }).then(() => {
    t.ok(true);
  });
});

test('callback functions should get called in correct order', t => {
  t.plan(6);

  let callbackCounter = 0;

  const db = new PouchDB('testdb', {db: require('memdown')});

  const createPersistentStore = persistentStore({
    db,
    onReady: function(reducerName, reducerState, store) {
      t.equal(callbackCounter, 4);
      callbackCounter++;
    },
    onInit: function(reducerName, reducerState, store) {
      t.equal(callbackCounter, 3);
      callbackCounter++;
    },
    onSave: function(reducerName, reducerState, store) {
      t.equal(callbackCounter, 1);
      callbackCounter++;
    }
  })(createStore);

  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer, {
    onInit: function(reducerName, reducerState, store) {
      t.equal(callbackCounter, 2);
      callbackCounter++;
    },
    onSave: function(reducerName, reducerState, store) {
      t.equal(callbackCounter, 0);
      callbackCounter++;
    }
  });
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    return db.destroy();
  }).then(() => {
    t.ok(true);
  });
});

test('should fix a race condition when changing the state directy one after another', t => {
  t.plan(7);

  const INCREMENT_X = 'INCREMENT_X';
  const INCREMENT_Y = 'INCREMENT_Y';
  const db = new PouchDB('testdb', {db : require('memdown')});
  const createPersistentStore = persistentStore({db})(createStore);
  const reducer = (state={x: 3, y: 7}, action) => {
    switch(action.type) {
      case 'INCREMENT_X':
        return { x: state.x + 1, y: state.y };
      case 'INCREMENT_Y':
        return { x: state.x, y: state.y + 1 };
      default:
        return state;
    }
  }
  const finalReducer = persistentReducer(reducer);
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    t.equal(store.getState().x, 3);
    t.equal(store.getState().y, 7);
    return db.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, doc.state.x);
    t.equal(store.getState().y, doc.state.y);
  }).then(() => {
    store.dispatch({type: INCREMENT_X});
    store.dispatch({type: INCREMENT_Y});
    return timeout(500);
  }).then(() => {
    return db.get(reducer.name);
  }).then(doc => {
    t.equal(store.getState().x, 4);
    t.equal(store.getState().y, 8);
    return db.destroy();
  }).then(() => {
    t.ok(true);
  });
});

test('should correctly recognize if database is in sync with reducer state', t => {
  t.plan(4);

  const db = new PouchDB('testdb', {db : require('memdown')});
  const createPersistentStore = persistentStore({db})(createStore);
  const reducer = setupPlainReducer();
  const finalReducer = persistentReducer(reducer);
  const store = createPersistentStore(finalReducer);

  timeout(500).then(() => {
    t.equal(inSync(), true);
    store.dispatch({type: INCREMENT});
    store.dispatch({type: INCREMENT});
    t.equal(inSync(), false);
    return timeout(500);
  }).then(() => {
    t.equal(inSync(), true);
    return db.destroy();
  }).then(() => {
    t.ok(true);
  });
});
