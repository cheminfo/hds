'use strict';

const extend = require('extend');
const mongoose = require('mongoose');
const debug = require('debug')('hds:init');
const mongo = require('./mongo');

var defaultOptions = {
    database: {
        host: '127.0.0.1',
        port: 27017,
        name: 'hds',
        user: null,
        pass: null
    }
};

var customs = {};

exports.init = function initHds(options) {

    options = extend(true, {}, defaultOptions, options);

    return new Promise(function (resolve, reject) {
        if (typeof options.database === 'string') {
            mongoose.connect(options.database);
        } else {
            var mongoOptions = {};
            var dbOptions = options.database;
            if (dbOptions.user && dbOptions.pass) {
                mongoOptions.user = dbOptions.user;
                mongoOptions.pass = dbOptions.pass;
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
};

exports.close = function closeHds() {
    return new Promise(function (resolve) {
        mongoose.disconnect(function () {
            resolve();
        });
    });

};

exports.customCollection = function customCollection(name, schema) {
    if (customs[name]) {
        return customs[name];
    }
    if (schema) {
        if (!schema instanceof mongoose.Schema) {
            schema = new mongoose.Schema(schema);
        }
        return customs[name] = mongoose.model('custom_' + name, schema, 'custom_' + name);
    } else {
        throw new Error('Custom collection ' + name + ' is not defined yet');
    }
};

exports.dropDatabase = function dropDatabase() {
    return new Promise(function (resolve, reject) {
        mongoose.connection.db.dropDatabase(function (err) {
            if (err) {
                return reject(err);
            }
            resolve();
        })
    });
};

exports.mongo = mongoose.mongo;
exports.Schema = mongoose.Schema;

exports.Kind = require('./kind');

exports.Entry = require('./entry');

exports.Query = require('./query');

exports.Group = require('./group');
