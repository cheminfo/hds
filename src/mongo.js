'use strict';

var mongoose = require('mongoose'),
    mongo = mongoose.mongo,
    GridStore = mongo.GridStore,
    ObjectID = mongo.ObjectID,
    GridStream = require('gridfs-stream');

GridStream.mongo = mongo;

var mongoDB; // MongoDB database instance, needed for gridFS;
var gridStream; // GridFS-Stream instance

exports._setMongo = function (db) {
    mongoDB = db;
    gridStream = GridStream(db);
};

exports.writeFile = function (content, filename, options, callback) {
    var gridStore = new GridStore(mongoDB, new ObjectID(), filename, 'w', options);
    gridStore.open(function (err, gridStore) {
        if (err)
            return callback(err);
        gridStore.write(content, function (err, gridStore) {
            if (err)
                return callback(err);
            gridStore.close(callback);
        });
    });
};

exports.readFile = function (fileId, options, callback) {
    var gridStore = new GridStore(mongoDB, ObjectID(fileId), 'r', options);
    gridStore.open(function (err) {
        if (err)
            return callback(err);
        gridStore.seek(0, function () {
            gridStore.read(callback);
        });
    });
};

exports.writeStream = function (stream, options, callback) {
    var writeStream = gridStream.createWriteStream(options);
    stream.pipe(writeStream);
    writeStream.on('close', function (res) {
        callback(null, res);
    });
    writeStream.on('error', function (err) {
        callback(err);
    });
};

exports.readStream = function (options, callback) {
    var id = options._id ? ObjectID(options._id) : options.name;
    if (!id) {
        return callback(Error('mongo.readStream: need option _id or name'));
    }
    var gs = new GridStore(mongoDB, id, 'r', {
        root: options.root
    });
    gs.open(function (err, gs) {
        if (err)
            return callback(err);
        var stream = new PassThrough();
        gs.stream().pipe(stream);
        callback(null, {
            stream: stream,
            filename: gs.filename,
            contentType: gs.contentType,
            length: gs.length
        });
    });
};

exports.removeFile = function (fileId, collection, callback) {
    gridStream.remove({
        _id: fileId,
        root: collection
    }, callback);
};