'use strict';

var extend = require('extend'),
    mongoose = require('mongoose'),
    debug = require('debug')('hds:init'),
    mongo = require('./mongo');

var defaultOptions = {
    database: {
        host: '127.0.0.1',
        port: 27017,
        name: 'hds',
        user: null,
        password: null
    }
};

exports.init = function (options, callback) {

    if (typeof options === 'function') {
        callback = options;
        options = null;
    }

    options = extend(true, defaultOptions, options);

    function initialize(cb) {

        var mongoOptions = {};
        var dbOptions = options.database;
        if (dbOptions.user && dbOptions.password) {
            mongoOptions.user = dbOptions.user;
            mongoOptions.password = dbOptions.password;
        }

        mongoose.connect(dbOptions.host, dbOptions.name, dbOptions.port, mongoOptions);

        var conn = mongoose.connection;
        conn.on('error', cb);

        conn.once('open', function () {
            debug('mongoDB connection established');
            mongo._setMongo(conn.db);
            cb(null);
        });

    }

    if (typeof callback === 'function') {
        return initialize(callback);
    } else {
        return initialize;
    }

};

exports.Kind = require('./kind');

exports.Entry = require('./entry');

exports.Query = require('./query');