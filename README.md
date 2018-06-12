# Redux PouchDB Plus

## About

**Redux PouchDB Plus** synchronizes a [Redux](rackt.github.io/redux) store with a [PouchDB](http://pouchdb.com/) database.

This code is heavily inspired (and some code reused) by Vicente de Alencar's [redux-pouchdb](https://github.com/vicentedealencar/redux-pouchdb).
So all Kudos to him. The rewrite was necessary to allow the following extras:

- Have different Pouch databases for different reducers.
- Allow to switch databases dynamically.
- Support for other state types (like [Immutable](https://facebook.github.io/immutable-js/) states).
- Provide several callbacks (when initialization and database access happens).
- Allow custom name for PouchDB document used by reducer. (great for multi-user applications)

The code is quite well tested using [tape](https://github.com/substack/tape).

## Usage

### General setup

The reducers you wish to persist should be enhanced with this higher order reducer (`persistentReducer`).

``` js
import { persistentReducer } from 'redux-pouchdb-plus';

const counter = (state = {count: 0}, action) => {
  switch(action.type) {
  case INCREMENT:
    return { count: state.count + 1 };
  case DECREMENT:
    return { count: state.count - 1 };
  default:
    return state;
  }
};

const finalReducer = persistentReducer(counter);
```

Compose a store enhancer (`persistentStore`) with other enhancers in order to initialize the persistence.

``` js
import { persistentStore } from 'redux-pouchdb-plus';

const db = new PouchDB('dbname');

//optional
const applyMiddlewares = applyMiddleware(
  thunkMiddleware,
  loggerMiddleware
);

const createStoreWithMiddleware = compose(
  applyMiddlewares,
  persistentStore({db})
)(createStore);

const store = createStoreWithMiddleware(finalReducer, initialState);
```

You may also provide a specific database for this reducer (it is prioritized over
the provided database to the store).

```js
const db2 = new PouchDB('another_dbname');
const finalReducer = persistentReducer(counter, {db: db2});
```

A custom name (\_id) can also be given to the document created/used for the reducer.

```js
const finalReducer = persistentReducer(counter, {name: 'custom name'});
```

### Switching databases during runtime

You may also provide a function that return a database connector instead of the
connector itself. This makes it possible to switch databases dynamically during runtime.

```js
import { reinit } from 'redux-pouchdb-plus';

let dbChoice = 1;
const db = (reducerName, store, additionalOptions) => {
  if (dbChoice === 1)
    return new PouchDB('dbname1');
  else
    return new PouchDB('dbname2');
}

// uses 'dbname1' database
const finalReducer = persistentReducer(counter, {db});

// switch to 'dbname2' database
dbChoice = 2;
// reinitialize reducer counter
store.dispatch(reinit('counter'));
// reinitialize all reducers
store.dispatch(reinit());
```

### Check if database is in sync

With the `inSync` method you can check if all state changes of persistent
reducers are saved to the database or if there is some saving in progress.

```js
import { inSync } from 'redux-pouchdb-plus';

if (inSync()) {
  // do something if the reducer states and the database are in sync
}
```

### Use Immutable js states

You can use [Immutable.js](https://facebook.github.io/immutable-js/) states
in your reducers by providing some serialization helpers as options.

```js
// import the necessary immutable stuff
import { Map, toJS, fromJS, is } from 'immutable'

// setup your reducer with immuatable state
const counter = (state = Map({count: 0}), action) => {
  switch(action.type) {
  case INCREMENT:
    return { count: state.count + 1 };
  case DECREMENT:
    return { count: state.count - 1 };
  default:
    return state;
  }
};

// provide the following options to make the serialization to the
// database work
const finalReducer = persistentReducer(counter, {
  toPouch: toJS,
  fromPouch: fromJS,
  isEqual: is
});
```

### Provided callback functions

You may provide the following callback functions as addition options to
`persistentReducer` or `persistentReducer`:

```js
// example for persistentStore, but works the same for persistentReducer function.
persistentStore(counter, {
  db,
  name,
  onInit: (reducerName, reducerState, store) => {
    // Called when this reducer was initialized
    // (the state was loaded from or saved to the
    // database for the first time or after a reinit action).
  },
  onUpdate: (reducerName, reducerState, store) => {
    // Called when the state of reducer was updated with
    // data from the database.
    // Cave! The store still contains the state before
    // the updated reducer state was applied to it.
  },
  onSave: (reducerName, reducerState, store) => {
    // Called every time the state of this reducer was
    // saved to the database.
  }
});
```

Additionally you may provide an `onReady` callback on the store that is called
every time all persistent recuders finished the initialization.

```js
persistentStore(counter, {
  db,
  onReady: (store) => {
    // Called when all reducers are initialized (also after
    // a reinit for all reducers is finished).
  }
}
```

## Notes

The current behavior is to have one document for each persisted reducer that looks like:

``` js
{
  _id: 'reducerName', // the name the reducer function, or the name provided by {name: 'custom name'}
  state: {}|[], // the state of the reducer
  _rev: '' // pouchdb keeps track of the revisions
}
```
