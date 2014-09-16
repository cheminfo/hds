'use strict';

var noop = exports.noop = function noop() {
};

exports.ensureCallback = function (callback) {
    if(typeof callback === 'function') {
        return callback;
    } else {
        return noop;
    }
};