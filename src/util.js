'use strict';

exports.noop = function noop() {
};

exports.ensureCallback = function ensureCallback(callback) {
    if (typeof callback === 'function') {
        return callback;
    } else {
        return exports.noop;
    }
};

exports.bindPromise = function bindPromise(promise, callback) {
    if (typeof callback === 'function') {
        promise.then(function (res) {
            callback(null, res);
        }, callback);
    }
    return promise;
};