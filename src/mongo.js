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