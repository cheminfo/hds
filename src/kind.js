'use strict';

var extend = require('extend'),
    async = require('async'),
    Promise = require('native-or-bluebird'),
    mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = mongoose.Schema.ObjectId,
    mongo = require('./mongo'),
    util = require('./util');

var dbRefSchema = {
    kind: {
        type: String
    },
    id: {
        type: ObjectId
    },
    _id: false
};

var attachmentSchema = {
    _id: ObjectId,
    fileId: ObjectId,
    name: 'string',
    mime: 'string',
    md5: 'string'
};

var baseDefinition = {
    _an: [dbRefSchema],         // Ancestors array
    _ch: [dbRefSchema],         // Children array
    _at: [attachmentSchema],    // Attachments array
    _dc: Date,                  // Date of creation
    _dm: Date,                  // Date of modification
    _gr: [String]               // Groups
};

var baseOptions = {
    strict: 'throw'
};

var kinds = {};

exports.notifyChange = function notifyChange(kind, newdef, newopts) {
    kinds[kind] = null;
    if (newdef) {
        exports.create(kind, newdef, newopts);
    }
};

var kindProvider = function defaultProvider(kind) {
    return Promise.reject(new Error('Kind ' + kind + ' not found'));
};

exports.setProvider = function setKindProvider(provider) {
    if (typeof provider === 'function') {
        kindProvider = provider;
    } else {
        throw new Error('Kind provider must be a function');
    }
};

exports.get = function getKindModel(name) {
    if (kinds[name]) {
        return Promise.resolve(kinds[name]);
    } else {
        return kindProvider(name).then(function gotKindHandler(res) {
            exports.create(name, res.definition, res.options);
            return kinds[name];
        });
    }
};

exports.getSync = function getKindModelSync(name) {
    if (!kinds[name]) {
        throw new Error('Kind ' + name + ' is not loaded');
    }
    return kinds[name];
};

var hooks = [
    'Save',
    'Remove',
    'Init',
    'Validate'
];

exports.create = function createKind(name, definition, options) {
    if (kinds[name]) {
        throw new Error('Cannot instantiate two kinds with the same name');
    }

    if (!definition || typeof definition !== 'object') {
        throw new Error('Kind definition has to be an object');
    }

    for (var i in definition) {
        if (i[0] === '_') {
            throw new Error('Kind definition cannot contain fields that begin with a "_". Found: ' + i);
        }
    }

    var thisDef = extend({}, baseDefinition, definition);
    var thisOptions = extend({}, baseOptions);

    var thisSchema = new Schema(thisDef, thisOptions);

    options = options || {};

    var hookName, preHookName, postHookName;
    for (i = 0; i < hooks.length; i++) {
        hookName = hooks[i];
        preHookName = 'pre' + hookName;
        if (options[preHookName] && typeof options[preHookName] === 'function') {
            thisSchema.pre(hookName.toLowerCase(), options[preHookName]);
        }
        postHookName = 'post' + hookName;
        if (options[postHookName] && typeof options[postHookName] === 'function') {
            thisSchema.post(hookName.toLowerCase(), options[postHookName]);
        }
    }

    thisSchema.pre('save', function (next) {
        if (!this._dc) {
            this._dc = this._id.getTimestamp();
        }

        this._dm = this.isNew ? this._dc : new Date();

        next();
    });

    thisSchema.index({
        '_an.kind': 1,
        '_an.id': 1
    });

    thisSchema.methods.getKind = thisSchema.statics.getKind = function () {
        return name;
    };

    thisSchema.virtual('owner').set(function (v) {
        this._gr[0] = v; // TODO check
    }).get(function () {
        return this._gr[0];
    });

    thisSchema.methods.createChild = createChild;
    thisSchema.methods.getChildren = getChildren;
    //thisSchema.methods.setParent = setParent;

    thisSchema.methods.createAttachment = createAttachment;
    thisSchema.methods.removeAttachment = removeAttachment;
    thisSchema.methods.getAttachment = getAttachment;


    thisSchema.pre('save', preSaveChild);
    thisSchema.pre('remove', preRemove);

    return kinds[name] = mongoose.model('kind_' + name, thisSchema, 'kind_' + name);
};

function createChild(kind, value) {
    var self = this;
    if (self.isNew) {
        throw new Error('Cannot call method createChild of a new unsaved entry');
    }

    var KindModel = exports.getSync(kind);
    var child = new KindModel(value);
    child._gr = self._gr.slice();                           // By default, owner is propagated
    for (var i = 0; i < self._an.length; i++) {
        child._an.push({
            kind: self._an[i].kind,
            id: self._an[i].id
        });
    }
    child._an.push({
        kind: self.getKind(),
        id: self._id
    });
    child._newChild = true;
    child._parent = self;

    return child;
}

function preSaveChild(next) {
    var self = this;
    if (self._newChild) {
        var parentModel = exports.getSync(self._parent.getKind());
        parentModel.findByIdAndUpdate(self._parent._id, {
            $push: {
                _ch: {
                    kind: self.getKind(),
                    id: self._id
                }
            }
        }, function (err) {
            if (err) {
                return next(err);
            }
            self._newChild = false;
            next();
        });
    } else {
        next();
    }
}

function preRemove(next) {
    var self = this;
    var ref = {
        kind: self.getKind(),
        id: self._id
    };

    exports.getSync(ref.kind).findById(ref.id, function (err, res) {
        if (err) {
            return next(err);
        }
        // First we have to remove the reference from the parent
        if (res._an.length) {
            var parent = res._an[res._an.length - 1];
            exports.get(parent.kind, function (err, parentModel) {
                if (err) {
                    return next(err);
                }
                parentModel.findByIdAndUpdate(parent.id, {
                    $pull: {
                        _ch: ref
                    }
                }, function (err) {
                    if (err) {
                        return next(err);
                    }
                    async.each(res._ch, removeEntryChildrenAndAttachments, next);
                });
            });
        } else {
            async.each(res._ch, removeEntryChildrenAndAttachments, next);
        }
    });
}

function removeEntryChildrenAndAttachments(entry, cb) {
    exports.get(entry.kind, function (err, entryModel) {
        if (err) {
            return cb(err);
        }
        var childrenRemoved = false,
            attachmentsRemoved = false;

        function checkFinish() {
            if (childrenRemoved && attachmentsRemoved) {
                cb();
            }
        }

        entryModel.findByIdAndRemove(entry.id, function (err, result) {
            if (err) {
                return cb(err);
            }
            if (result) {
                async.each(result._ch, removeEntryChildrenAndAttachments, function (err) {
                    if (err) {
                        return cb(err);
                    }
                    childrenRemoved = true;
                    checkFinish();
                });
                async.each(result._at, removeEntryAttachment, function (err) {
                    if (err) {
                        return cb(err);
                    }
                    attachmentsRemoved = true;
                    checkFinish();
                });
            } else {
                cb();
            }
        });
    });
}

function removeEntryAttachment(att, cb) {
    mongo.removeFile(att.fileId, 'attachments', cb);
}

var getChildrenOptions = {
    kind: null,
    groupKind: false
};
function getChildren(options) {
    var self = this;
    options = extend({}, getChildrenOptions, options);

    var ref = {
        kind: self.getKind(),
        id: self._id
    };

    return new Promise(function (resolve, reject) {
        if (options.kind) { // Search all children of a specific kind
            exports.get(options.kind).then(function (kindModel) {
                kindModel.find({
                    _an: {
                        $elemMatch: ref
                    }
                }, function (err, res) {
                    if (err) {
                        return reject(err);
                    }
                    resolve(res);
                });
            }, reject);
        } else { // Retrieve all first level children of this entry
            var kindModel = exports.getSync(ref.kind);
            kindModel.findOne(self._id, function (err, res) {
                if (err) {
                    return reject(err);
                } else if (!res) {
                    return reject(new Error('Entry with id ' + self._id + ' does not exist anymore'));
                }
                if (!options.groupKind) { // Put all children in the same array
                    async.map(res._ch, function(el, callback){
                        getChild(el).then(function (ch) {
                            callback(null, ch);
                        }, function (err) {
                            callback(err);
                        });
                    }, function (err, res) {
                        if (err) {
                            return reject(err);
                        }
                        resolve(res);
                    });
                } else { // Group by child kind
                    var children = {};
                    async.each(res._ch, function (el, cb) {
                        if (!children[el.kind]) {
                            children[el.kind] = [];
                        }
                        exports.get(el.kind).then(function (KindModel) {
                            KindModel.findOne(el.id, function (err, child) {
                                if (err) {
                                    return cb(err);
                                }
                                children[el.kind].push(child);
                                cb();
                            });
                        }, cb);
                    }, function (err) {
                        if (err) {
                            return reject(err);
                        }
                        resolve(children);
                    });
                }
            });
        }
    });
}

function getChild(child) {
    return new Promise(function (resolve, reject) {
        exports.get(child.kind).then(function (kindModel) {
            kindModel.findOne(child.id, function (err, res) {
                err ? reject(err) : resolve(res);
            });
        }, reject);
    });
}

/** TODO enable setParent
 function setParent(other, callback) {
    var kind = this.getKind(),
        id = this._id;
    exports.getSync(kind).findById(id, function (err, that) {
        if(err) {
            return callback(err);
        }
        if(that._an.length) {

        }
    });
}
 */

function createAttachment(attachment) {
    var self = this;
    if (self.isNew) {
        throw new Error('Cannot call method createAttachment of a new unsaved entry');
    }
    var data = new Buffer(attachment.value, attachment.encoding || 'utf-8');
    return mongo.writeFile(data, attachment.filename, {
        root: 'attachments',
        content_type: attachment.mimetype
    }).then(function (fileData) {
        var attachment = {
            _id: fileData._id,
            fileId: fileData._id,
            name: fileData.filename,
            mime: fileData.contentType,
            md5: fileData.md5
        };
        return exports.getSync(self.getKind()).findByIdAndUpdate(self._id, {
            $push: {
                _at: attachment
            }
        }).exec().then(function () {
            return attachment;
        });
    });
}

function removeAttachment(attachmentId) {
    var self = this;
    return new Promise(function (resolve, reject) {
        exports.getSync(self.getKind()).findOneAndUpdate({
            _id: self._id,
            '_at._id': attachmentId
        }, {
            $pull: {
                _at: {
                    _id: attachmentId
                }
            }
        }, {
            'new': false // Important because we need to retrieve the fileId
        }, function (err, res) {
            if (err) {
                return reject(err);
            }
            if (!res) { // Attachment not found
                return reject(new Error('attachment with id ' + attachmentId.toString() + ' not found'));
            }
            resolve(null); // File can be removed from GridFS later
            for (var i = 0, ii = res._at.length; i < ii; i++) {
                if (res._at[i]._id.toString() === attachmentId.toString()) {
                    mongo.removeFile(res._at[i].fileId, 'attachments', util.noop);
                }
            }
        });
    });
}

function getAttachment(attachmentId) {
    var self = this;
    return new Promise(function (resolve, reject) {
        exports.getSync(self.getKind()).findOne({
            _id: self._id,
            '_at._id': attachmentId
        }, '_at.$.fileId', function (err, res) {
            if (err) {
                return reject(err);
            }
            mongo.readFile(res._at[0].fileId, {
                root: 'attachments'
            }, function (err, res) {
                err ? reject(err) : resolve(res);
            });
        });
    });
}
