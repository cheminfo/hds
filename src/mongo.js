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

exports.writeFile = function (content, filename, options) {
    return new Promise(function (resolve, reject) {
        var gridStore = new GridStore(mongoDB, new ObjectID(), filename, 'w', options);
        gridStore.open(function (err, gridStore) {
            if (err) {
                return reject(err);
            }
            gridStore.write(content, function (err, gridStore) {
                if (err) {
                    return reject(err);
                }
                gridStore.close(function (err, result) {
                    if (err) {
                        return reject(err);
                    }
                    resolve(result);
                });
            });
        });
    });
};

exports.readFile = function (fileId, options) {
    return new Promise(function (resolve, reject) {
        var gridStore = new GridStore(mongoDB, ObjectID(fileId), 'r', options);
        gridStore.open(function (err, gsObject) {
            if (err) {
                return reject(err);
            }
            gridStore.seek(0, function () {
                gridStore.read(function (err, result) {
                    if (err) {
                        return reject(err);
                    }
                    resolve({
                        fileId: gsObject.fileId,
                        filename: gsObject.filename,
                        mimetype: gsObject.contentType,
                        content: result,
                        md5: gsObject.internalMd5
                    });
                });
            });
        });
    });
};

exports.writeStream = function (stream, options) {
    return new Promise(function (resolve, reject) {
        var writeStream = gridStream.createWriteStream(options);
        stream.pipe(writeStream);
        writeStream.on('close', function (res) {
            resolve(res);
        });
        writeStream.on('error', function (err) {
            reject(err);
        });
    });
};

exports.readStream = function (options) {
    return new Promise(function (resolve, reject) {
        var id = options._id ? ObjectID(options._id) : options.name;
        if (!id) {
            return reject(new Error('mongo.readStream: need option _id or name'));
        }
        var gs = new GridStore(mongoDB, id, 'r', {
            root: options.root
        });
        gs.open(function (err, gs) {
            if (err) {
                return reject(err);
            }
            var stream = new PassThrough();
            gs.stream().pipe(stream);
            resolve({
                stream: stream,
                filename: gs.filename,
                contentType: gs.contentType,
                length: gs.length
            });
        });
    });
};

exports.removeFile = function (fileId, collection) {
    return new Promise(function (resolve, reject) {
        gridStream.remove({
            _id: fileId,
            root: collection
        }, function (err, res) {
            if (err) {
                return reject(err);
            }
            resolve(res);
        });
    });
};
