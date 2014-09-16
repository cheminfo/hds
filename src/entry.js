'use strict';

var Kind = require('./kind');

exports.create = function createEntry(kind, value) {
    var kindModel = Kind.getSync(kind);
    return new kindModel(value);
};

exports.findOne = function findOneEntry(kind, conditions, fields, options, callback) {
    var kindModel = Kind.getSync(kind);
    return kindModel.findOne(conditions, fields, options, callback);
};

exports.find = function findEntries(kind, conditions, fields, options, callback) {
    var kindModel = Kind.getSync(kind);
    return kindModel.find(conditions, fields, options, callback);
};