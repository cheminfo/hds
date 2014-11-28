'use strict';

var Promise = require('native-or-bluebird');

exports.noop = function noop() {
};

exports.bindPromise = function bindPromise(promise, callback) {
    if (typeof callback === 'function') {
        promise.then(function (res) {
            callback(null, res);
        }, callback);
    }
    return promise;
};

exports.promisifySave = function (entry) {
    // TODO check mongoose updates
    // This is an addition to allow save to behave like a Promise
    var save = entry.save;
    entry.save = function (cb) {
        var prom = new Promise(function (resolve, reject){
            save.call(entry, function (err) {
                err ? reject(err) : resolve();
            });
        });
        return exports.bindPromise(prom, cb);
    };
}