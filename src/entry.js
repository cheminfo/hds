'use strict';

var Kind = require('./kind'),
    util = require('./util'),
    Promise = require('bluebird');

exports.create = function createEntry(kind, value) {
    var kindModel = Kind.getSync(kind);
    return new kindModel(value);
};

exports.insertTree = function (tree, callback) {

    var prom = new Promise(function (resolve, reject) {

        if(!tree) {
            return reject(new Error('missing tree parameter'));
        }

        Kind.get(tree.kind).then(function (kindModel) {

            var rootVal = new kindModel(tree.value);
            rootVal.save(function (err, rootVal) {

                if(err) {
                    return reject(err);
                }

                if(!tree.children) {
                    return resolve(rootVal);
                }

                appendChildren(rootVal, tree.children).then(function () {
                    resolve(rootVal);
                }, function (err) {
                    rootVal.remove(function () {
                        reject(err);
                    });
                });

            });

            // TODO hack mongoose bug !
            setTimeout(util.noop, 0);

        }, reject);

    });

    return util.bindPromise(prom, callback);

};

function appendChildren(parent, children) {

    return new Promise(function (resolve, reject) {

        if(!children instanceof Array) {
            return reject(new Error('children element must be an array'));
        }

        var childrenProm = [];
        for(var i = 0; i < children.length; i++) {
            childrenProm.push(appendChild(parent, children[i]));
        }

        Promise.all(childrenProm).then(resolve, reject);

    });

}

function appendChild(parent, child) {

    return new Promise(function (resolve, reject) {

        Kind.get(child.kind).then(function () {

            parent.createChild(child.kind, child.value).save(function (err, childObj) {
                if(err) {
                    return reject(err);
                }
                if(!child.children) {
                    resolve();
                } else {
                    appendChildren(childObj, child.children).then(resolve, reject);
                }

            });

        }, reject);

    });

}

exports.findOne = function findOneEntry(kind, conditions, fields, options, callback) {
    var kindModel = Kind.getSync(kind);
    return kindModel.findOne(conditions, fields, options, callback);
};

exports.find = function findEntries(kind, conditions, fields, options, callback) {
    var kindModel = Kind.getSync(kind);
    return kindModel.find(conditions, fields, options, callback);
};