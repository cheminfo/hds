'use strict';

const mongoose = require('mongoose');
const mongo = mongoose.mongo;
const GridStore = mongo.GridStore;
const ObjectID = mongo.ObjectID;

var mongoDB; // MongoDB database instance, needed for gridFS;

exports._setMongo = function (db) {
    mongoDB = db;
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
                        length: result.length,
                        md5: gsObject.internalMd5
                    });
                });
            });
        });
    });
};

exports.writeStream = function (stream, filename, options) {
    return new Promise(function (resolve, reject) {
        var gridStore = new GridStore(mongoDB, new ObjectID(), filename, 'w', options);
        var writeStream = gridStore.stream();
        writeStream.on('close', resolve);
        writeStream.on('error', reject);
        stream.pipe(writeStream);
    });
};

exports.readStream = function (fileId, options) {
    return new Promise(function (resolve, reject) {
        var gridStore = new GridStore(mongoDB, ObjectID(fileId), 'r', options);
        gridStore.open(function (err, gsObject) {
            if (err) {
                return reject(err);
            }
            var stream = gsObject.stream();
            resolve({
                fileId: gsObject.fileId,
                filename: gsObject.filename,
                mimetype: gsObject.contentType,
                stream: stream,
                length: gsObject.length,
                md5: gsObject.internalMd5
            });
        });
    });
};

exports.removeFile = function (fileId, options) {
    return new Promise(function (resolve, reject) {
        GridStore.unlink(mongoDB, ObjectID(fileId), options, function (err, res) {
            if (err) {
                return reject(err);
            }
            resolve(res);
        });
    });
};
