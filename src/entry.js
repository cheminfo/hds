'use strict';

const Kind = require('./kind');
const extend = require('extend');
const mongoose = require('mongoose');
const ObjectID = mongoose.mongo.ObjectID;
const async = require('async');

exports.create = function createEntry(kind, value, options) {

    if (arguments.length === 2) {
        options = value;
        value = null;
    }

    options = options || {};

    var KindModel = Kind.getSync(kind);
    var entry = new KindModel(value);
    // TODO handle options
    if (!options.owner) {
        throw new Error('cannot create an entry without owner');
    }
    entry._gr = [options.owner];

    return entry;

};

// Insert, update and/or delete multiple entries with a single instruction
/*
 Supported actions:
 - insert (default) : search entries with query. If no entry found create a new one, if one entry found modify its value, if more than one entry found error, then treat children
 - delete : remove all entries that match query then stop
 - add : insert new entry without searching, then treat children
 - replace : remove all entries that match query, then create entry with value, then treat children
 */
exports.batch = function (data, options) {
    if (Array.isArray(data)) {
        return Promise.all(data.map(function (dataVal) {
            return exports.batch(dataVal, options);
        }));
    } else {
        return new Promise(function (resolve, reject) {

            if (!data.kind) {
                return reject(new Error('Batch method requires a kind for each element'));
            }

            var action = data.action || 'insert';

            options = options || {};
            if (!options.owner) {
                reject(new Error('Batch method requires an owner'));
            } else {
                if (options.parent) {
                    Kind.get(options.parent.kind).then(function (parentModel) {
                        parentModel.findById(options.parent.id, function (err, parent) {
                            if (err) {
                                reject(err);
                            } else if (parent) {
                                insertElement(parent);
                            } else {
                                reject(new Error('Parent ' + JSON.stringify(options.parent) + 'does not exist'));
                            }
                        });
                    }, reject);
                } else {
                    insertElement();
                }
            }

            function insertElement(parent) {
                Kind.get(data.kind).then(function (KindModel) {

                    var query = {
                        $and: [
                            extend({}, data.query, {
                                '_gr.0': options.owner
                            })
                        ]
                    };

                    if (parent) {
                        var parentQuery = {
                            kind: parent.getKind(),
                            id: parent.id
                        };
                        query.$and.unshift({_an: {$elemMatch: parentQuery}});
                    } else {
                        query.$and.unshift({_an: {$size: 0}});
                    }

                    var finalCallback = getFinalCallback(resolve, reject),
                        nextCallback = getNextCallback(resolve, reject, data);

                    function createNewEntry(value, callback) {
                        var objData, obj;
                        if (value) {
                            objData = extend({}, value.value, {_gr: [options.owner]});
                            obj = parent ? parent.createChild(data.kind, objData) : new KindModel(objData);
                            obj.save(function (err, entry) {
                                if (err) {
                                    callback(err);
                                } else {
                                    if (value.attachments) {
                                        async.each(value.attachments, addAttachment(entry), callback);
                                    } else {
                                        callback();
                                    }
                                }
                            });
                        } else {
                            objData = extend({}, data.query, data.value, {_gr: [options.owner]});
                            obj = parent ? parent.createChild(data.kind, objData) : new KindModel(objData);
                            obj.save(function (err, entry) {
                                if (err) {
                                    nextCallback(err);
                                } else {
                                    if (data.attachments) {
                                        async.each(data.attachments, addAttachment(entry), function (err) {
                                            if (err) {
                                                nextCallback(err);
                                            } else {
                                                nextCallback(null, entry);
                                            }
                                        });
                                    } else {
                                        nextCallback(null, entry);
                                    }
                                }
                            });
                        }
                    }

                    function addNewEntries(err) {
                        if (err) {
                            return reject(err);
                        }
                        var values = data.values || [
                                {value: data.value, attachments: data.attachments}
                            ];
                        async.each(values, createNewEntry, finalCallback);
                    }

                    if (action === 'add') {
                        createNewEntry();
                    } else {
                        KindModel.find(query, function (err, res) {
                            if (err) {
                                reject(err);
                            } else if (res.length) {
                                if (action === 'delete') {
                                    async.each(res, removeEntry, finalCallback);
                                } else if (action === 'replace') {
                                    async.each(res, removeEntry, addNewEntries);
                                } else if (action === 'insert') {
                                    if (res.length > 1) {
                                        reject(new Error('Query lacks specificity. ' + res.length + ' matching documents found'));
                                    } else {
                                        res = res[0];
                                        for (var i in data.value) {
                                            if (data.value.hasOwnProperty(i)) {
                                                res[i] = data.value[i];
                                            }
                                        }
                                        res.save(nextCallback);
                                    }
                                } else {
                                    reject(new Error('Unknown action: ' + action));
                                }
                            } else {
                                if (action === 'delete') {
                                    reject(new Error('Entry not found, cannot remove'));
                                } else if (action === 'replace') {
                                    addNewEntries();
                                } else if (action === 'insert') {
                                    createNewEntry();
                                } else {
                                    reject(new Error('Unknown action: ' + action));
                                }
                            }
                        });
                    }
                });
            }

        });
    }
};

function addAttachment(entry) {
    return function addAttachmentToEntry(attachment, callback) {
        entry.createAttachment(attachment).then(function (result) {
            callback(null, result);
        }, function (err) {
            callback(err);
        });
    };
}

function removeEntry(entry, callback) {
    entry.remove(callback);
}

function getFinalCallback(resolve, reject) {
    return function finalCallback(err) {
        if (err) {
            return reject(err);
        }
        resolve();
    };
}

function getNextCallback(resolve, reject, data) {
    return function nextCallback(err, entry) {
        if (err) {
            return reject(err);
        }
        // TODO attachments
        if (data.children) {
            var promises = data.children.map(function (child) {
                return _batch(child, entry);
            });
            Promise.all(promises).then(resolve, reject);
        } else {
            resolve();
        }
    };
}

function _batch(data, parent) {
    return new Promise(function (resolve, reject) {

        if (!data.kind) {
            return reject(new Error('Batch method requires a kind for each element'));
        }

        var action = data.action || 'insert';

        var parentQuery = {
            kind: parent.getKind(),
            id: new ObjectID(parent.id)
        };

        var ancestors = parent._an.slice();
        ancestors.push(parentQuery);

        Kind.get(data.kind).then(function (KindModel) {

            var query = {
                $and: [
                    {_an: {$elemMatch: parentQuery}},
                    {'_gr.0': parent.owner, _an: ancestors}
                ]
            };
            if (data.query) {
                query.$and.push(extend({}, data.query));
            }

            var finalCallback = getFinalCallback(resolve, reject),
                nextCallback = getNextCallback(resolve, reject, data);

            function createNewEntry(value, callback) {
                var obj;
                if (value) {
                    obj = parent.createChild(data.kind, extend({}, value.value));
                    obj.save(function (err, entry) {
                        if (err) {
                            callback(err);
                        } else {
                            if (value.attachments) {
                                async.each(value.attachments, addAttachment(entry), callback);
                            } else {
                                callback();
                            }
                        }
                    });
                } else {
                    obj = parent.createChild(data.kind, extend({}, data.query, data.value));
                    obj.save(function (err, entry) {
                        if (err) {
                            nextCallback(err);
                        } else {
                            if (data.attachments) {
                                async.each(data.attachments, addAttachment(entry), function (err) {
                                    if (err) {
                                        nextCallback(err);
                                    } else {
                                        nextCallback(null, entry);
                                    }
                                });
                            } else {
                                nextCallback(null, entry);
                            }
                        }
                    });
                }
            }

            function addNewEntries(err) {
                if (err) {
                    return reject(err);
                }
                var values = data.values || [
                        {value: data.value, attachments: data.attachments}
                    ];
                async.each(values, createNewEntry, finalCallback);
            }

            if (action === 'add') {
                createNewEntry();
            } else {
                KindModel.find(query, function (err, res) {
                    if (err) {
                        reject(err);
                    } else if (res.length) {
                        if (action === 'delete') {
                            async.each(res, removeEntry, finalCallback);
                        } else if (action === 'replace') {
                            async.each(res, removeEntry, addNewEntries);
                        } else if (action === 'insert') {
                            if (res.length > 1) {
                                reject(new Error('Query lacks specificity. ' + res.length + ' matching documents found'));
                            } else {
                                res = res[0];
                                for (var i in data.value) {
                                    if (data.value.hasOwnProperty(i)) {
                                        res[i] = data.value[i];
                                    }
                                }
                                res.save(nextCallback);
                            }
                        } else {
                            reject(new Error('Unknown action: ' + action));
                        }
                    } else {
                        if (action === 'delete') {
                            reject(new Error('Entry not found, cannot remove'));
                        } else if (action === 'replace') {
                            addNewEntries();
                        } else if (action === 'insert') {
                            createNewEntry();
                        } else {
                            reject(new Error('Unknown action: ' + action));
                        }
                    }
                });
            }
        });
    });
}

exports.insertTree = function (tree, options) {

    options = options || {};
    if (!options.owner) {
        throw new Error('cannot create an entry without owner');
    }

    return new Promise(function (resolve, reject) {

        if (!tree) {
            return reject(new Error('missing tree parameter'));
        }

        Kind.get(tree.kind).then(function (KindModel) {

            var rootVal = new KindModel(tree.value);
            rootVal.owner = options.owner;
            rootVal.save(function (err, rootVal) {

                if (err) {
                    return reject(err);
                }

                if (!tree.children) {
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
            setTimeout(function () {
            }, 0);

        }, reject);

    });
};

function appendChildren(parent, children) {

    return new Promise(function (resolve, reject) {

        if (!children instanceof Array) {
            return reject(new Error('children element must be an array'));
        }

        var childrenProm = [];
        for (var i = 0; i < children.length; i++) {
            childrenProm.push(appendChild(parent, children[i]));
        }

        Promise.all(childrenProm).then(resolve, reject);

    });

}

function appendChild(parent, child) {

    return new Promise(function (resolve, reject) {

        Kind.get(child.kind).then(function () {

            parent.createChild(child.kind, child.value).save(function (err, childObj) {
                if (err) {
                    return reject(err);
                }
                if (!child.children) {
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
