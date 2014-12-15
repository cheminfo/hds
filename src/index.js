'use strict';

var extend = require('extend'),
    mongoose = require('mongoose'),
    debug = require('debug')('hds:init'),
    mongo = require('./mongo'),
    Promise = require('native-or-bluebird'),
    util = require('./util');

var defaultOptions = {
    database: {
        host: '127.0.0.1',
        port: 27017,
        name: 'hds',
        user: null,
        password: null
    }
};
var customs = {};

exports.init = function initHds(options, callback) {

    if (typeof options === 'function') {
        callback = options;
        options = null;
    }

    options = extend(true, {}, defaultOptions, options);

    var prom = new Promise(function (resolve, reject) {
        if(typeof options.database === 'string') {
            mongoose.connect(options.database);
        } else {
            var mongoOptions = {};
            var dbOptions = options.database;
            if (dbOptions.user && dbOptions.password) {
                mongoOptions.user = dbOptions.user;
                mongoOptions.password = dbOptions.password;
            }
            mongoose.connect(dbOptions.host, dbOptions.name, dbOptions.port, mongoOptions);
        }

        var conn = mongoose.connection;
        conn.on('error', reject);

        conn.once('open', function () {
            debug('mongoDB connection established');
            mongo._setMongo(conn.db);
            resolve();
        });
    });

    return util.bindPromise(prom, callback);

};

exports.close = function closeHds(callback) {

    var prom = new Promise(function (resolve) {
        mongoose.disconnect(function () {
            resolve();
        });
    });
    return util.bindPromise(prom, callback);

};

exports.customCollection = function customCollection(name, schema) {
    if (!schema instanceof mongoose.Schema) {
        throw new Error('Provided schema is of invalid type');
    }
    return customs[name] = mongoose.model('custom_' + name, schema, 'custom_' + name);
};

exports.dropDatabase = function dropDatabase(callback) {
    var prom = new Promise(function (resolve, reject) {
        mongoose.connection.db.dropDatabase(function (err) {
            if (err) {
                return reject(err);
            }
            resolve();
        })
    });
    return util.bindPromise(prom, callback);
};

exports.getSync = function getCustomModelSync(name) {
    if (!customs[name]) {
        throw new Error('Custom ' + name + ' is not loaded');
    }
    return customs[name];
};

exports.mongo = mongoose.mongo;
exports.Schema = mongoose.Schema;

exports.Kind = require('./kind');

exports.Entry = require('./entry');

exports.Query = require('./query');

exports.Group = require('./group');