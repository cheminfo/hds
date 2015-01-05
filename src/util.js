'use strict';

var Promise = require('native-or-bluebird');

exports.noop = function noop() {
};

exports.promisifySave = function (entry) {
    // TODO check mongoose updates
    // This is an addition to allow save to behave like a Promise
    var save = entry.save;
    entry.save = function () {
        return new Promise(function (resolve, reject) {
            save.call(entry, function (err) {
                err ? reject(err) : resolve();
            });
        });
    };
};
