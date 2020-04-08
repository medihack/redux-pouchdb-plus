"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.inSync = inSync;
var unpersistedQueue = {};
var isSaving = {};

// checks if there is some state saving in progress
function inSync() {
  var reducerNames = Object.keys(isSaving);
  var _iteratorNormalCompletion = true;
  var _didIteratorError = false;
  var _iteratorError = undefined;

  try {
    for (var _iterator = reducerNames[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
      var n = _step.value;

      if (isSaving[n]) return false;
    }
  } catch (err) {
    _didIteratorError = true;
    _iteratorError = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion && _iterator.return) {
        _iterator.return();
      }
    } finally {
      if (_didIteratorError) {
        throw _iteratorError;
      }
    }
  }

  return true;
}

exports.default = function (db, localId) {
  var saveReducer = function saveReducer(reducerName, reducerState) {
    if (isSaving[reducerName]) {
      // enqueue promise
      unpersistedQueue[reducerName] = unpersistedQueue[reducerName] || [];
      unpersistedQueue[reducerName].push(reducerState);

      return Promise.resolve();
    }

    isSaving[reducerName] = true;

    return db.get(reducerName).catch(function (err) {
      if (err.status === 404) {
        return { _id: reducerName };
      } else {
        throw err;
      }
    }).catch(function (err) {
      console.error(err);
    }).then(function (doc) {
      doc.localId = localId;
      doc.state = reducerState;
      return doc;
    }).then(function (doc) {
      return db.put(doc);
    }).then(function () {
      delete isSaving[reducerName];

      if (unpersistedQueue[reducerName] && unpersistedQueue[reducerName].length > 0) {
        var next = unpersistedQueue[reducerName].shift();
        return saveReducer(reducerName, next);
      }
    }).catch(function (err) {
      console.error(err);
    });
  };

  return saveReducer;
};