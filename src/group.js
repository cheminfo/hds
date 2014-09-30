var mongoose = require('mongoose'),
    util = require('./util'),
    validator = require('validator');

var Rights = {
    READ: 1,
    WRITE: 2,
    ATTACH: 4,
    CHILD: 8,
    ADMIN: 0x80000000,
    MANAGER: 0x40000000
};

Rights.ADMIN_OR_MANAGER = Rights.ADMIN | Rights.MANAGER;
Rights.READ_WRITE = Rights.READ | Rights.WRITE;

exports.Rights = Rights;

var singleRightSchema = new mongoose.Schema({
    _id: 0,
    kind: String,
    right: {
        type: Number,
        'default': 0
    }
});

var rightSchema = new mongoose.Schema({
    parent: String,
    child: String,
    rights: [singleRightSchema]
});

rightSchema.methods.hasRight = function (right, kind) {
    var thisRight;
    for(var i = 0, ii = this.rights.length; i < ii; i++) {
        thisRight = this.rights[i];
        if (((thisRight.right & right) !== 0) && (thisRight.kind === kind)) {
            return true;
        }
    }
    return false;
};

rightSchema.methods.addRight = function (right) {
    var kind = right.kind,
        thisRight;
    for(var i = 0, ii = this.rights.length; i < ii; i++) {
        if(this.rights[i].kind === kind) {
            thisRight = this.rights[i];
            break;
        }
    }
    if(!thisRight) {
        thisRight = this.rights.create();
        if(kind) {
            thisRight.kind = kind;
        }
        this.rights.push(thisRight);
    }
    thisRight.right = thisRight.right |
        (right.read ? Rights.READ : 0) |
        (right.write ? Rights.WRITE : 0) |
        (right.attach ? Rights.ATTACH : 0) |
        (right.child ? Rights.CHILD : 0);
};

var Right = mongoose.model('Right', rightSchema, 'rights');

exports.addRight = function addRight(target, group, user, right, callback) {
    var prom = new Promise(function (resolve, reject) {
        Right.findOne({
            parent: group,
            child: user
        }, function (err, res) {
            if (err) {
                reject(err);
            } else if (res) {
                if(res.hasRight(Rights.ADMIN_OR_MANAGER)) {
                    Right.findOne({
                        parent: group,
                        child: target
                    }, function (err, res) {
                        if (err) {
                            return reject(err);
                        } else if (!res) {
                            res = new Right({
                                parent: group,
                                child: target
                            });
                        }
                        res.addRight(right);
                        res.save(function (err) {
                            if (err) {
                                return reject(err);
                            }
                            resolve();
                        });
                    });
                } else {
                    reject(new Error('user "'+ user + '" has not enough rights on group "'+ group +'"'));
                }
            } else {
                reject(new Error('No group found with name "' + group + '" and user "' + user + '"'));
            }
        });
    });
    return util.bindPromise(prom, callback);
};

exports.create = function createGroup(name, user, callback) {
    var prom = new Promise(function (resolve, reject) {

        if (validator.isEmail(name)) {
            return reject(new Error('Group name cannot be an email'));
        } else if (!validator.isEmail(user)) {
            return reject(new Error('User must be an email'));
        }

        Right.findOne({
            parent: name
        }, function (err, res) {
            if (err) {
                reject(err);
            } else if (res) {
                reject(new Error('The group "'+name+'" already exists'));
            } else {
                var newRight = new Right({
                    parent: name,
                    child: user,
                    rights: [ { right: Rights.ADMIN } ]
                });
                newRight.save(function(err) {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
            }
        });

    });
    return util.bindPromise(prom, callback);
};

exports.getRights = function (group, callback) {
    var prom = new Promise(function (resolve, reject) {

        var known = {};
        var rights = {};

        Group.find({
            child: group
        }, function (err, groups) {
            if (err) {
                return reject(err);
            } else if (groups.length) {
                BFS(groups, known, rights, function (err) {
                    if (err) {
                        return reject(err);
                    }
                    resolve(rights);
                });
            } else {
                resolve(rights);
            }
        });

    });
    return util.bindPromise(prom, callback);
};

//  http://en.wikipedia.org/wiki/Breadth-first_search
function BFS(groups, known, rights, callback) {
    async.each(groups, function (group, callback) {
        if(known[group.child]) {
            callback();
        } else {
            rights[group.parent] |= group.right;
            known[group.child] = true;
            Group.find({
                child: group.parent
            }, function (err, groups) {
                if (err) {
                    callback(err);
                } else {
                    BFS(groups, known, rights, callback);
                }
            });
        }
    }, callback);
}