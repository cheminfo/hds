var mongoose = require('mongoose'),
    util = require('./util'),
    validator = require('validator'),
    async = require('async');

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
    group: String,
    target: String,
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

exports.addRight = function addRight(group, target, user, right, callback) {
    var prom = new Promise(function (resolve, reject) {
        function addRights() {
            if(!(right instanceof Array)) {
                right = [right];
            }
            Right.findOne({
                group: group,
                target: target
            }, function (err, res) {
                if (err) {
                    return reject(err);
                } else if (!res) {
                    res = new Right({
                        group: group,
                        target: target
                    });
                }
                for(var i = 0; i < right.length; i++) {
                    res.addRight(right[i]);
                }
                res.save(function (err) {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
            });
        }
        if(group === user) { // User can add any right to his own data
            addRights();
        } else { // Verify that user is allowed to edit the target group
            Right.findOne({
                group: group,
                target: user
            }, function (err, res) {
                if (err) {
                    reject(err);
                } else if (res) {
                    if(res.hasRight(Rights.ADMIN_OR_MANAGER)) {
                        addRights();
                    } else {
                        reject(new Error('user "'+ user + '" has not enough rights on group "'+ group +'"'));
                    }
                } else {
                    reject(new Error('No group found with name "' + group + '" and user "' + user + '"'));
                }
            });
        }
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
            group: name
        }, function (err, res) {
            if (err) {
                reject(err);
            } else if (res) {
                reject(new Error('The group "'+name+'" already exists'));
            } else {
                var newRight = new Right({
                    group: name,
                    target: user,
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

//  http://en.wikipedia.org/wiki/Breadth-first_search
exports.getRights = function (group, callback) {
    var prom = new Promise(function (resolve, reject) {

        var visited = {},
            rights = {};
        rights[group] = {
            _: 0xFFFFFFFF
        };

        BFS(group, visited, rights, function (err, res){
            if (err) {
                return reject(err);
            }
            resolve(new RightObject(group, res));
        });

    });
    return util.bindPromise(prom, callback);
};

function BFS(name, visited, rights, callback) {
    if(visited[name]) {
        return callback(null, rights);
    }
    visited[name] = true;
    Right.find({
        target: name
    }, function (err, res) {
        if(err) {
            callback(err);
        } else if (!res.length) {
            callback(null, rights);
        } else {
            async.each(res, function (group, cb) {
                var groupName = group.group,
                    right, kind;
                console.log('Current rights: ', rights);
                console.log('Parent:          '+name+', group: '+groupName);
                console.log('Rights to add:  ', group.rights);
                console.log('');
                if(!rights[groupName]) {
                    rights[groupName] = {};
                }
                for (var i = 0, ii = group.rights.length; i < ii; i++) {
                    right = group.rights[i];
                    kind = right.kind ? right.kind : '_';





                    if(!rights[groupName][kind]) {
                        if(rights[name][kind]) {
                            rights[groupName][kind] = rights[name][kind];
                        }
                    }



                    if(!rights[groupName][kind] || !rights[groupName]['_']) {
                        if(rights[name].hasOwnProperty(kind)) {
                            rights[groupName][kind] = rights[name][kind];
                        } else if(rights[name].hasOwnProperty('_')) {
                            rights[groupName][kind] = rights[name]['_'];
                        } else {
                            rights[groupName][kind] = 0xFFFFFFFF;
                        }
                    }
                    rights[groupName][kind] &= right.right;
                }
                BFS(group.group, visited, rights, cb);
            }, function (err){
                if(err) {
                    callback(err);
                } else {
                    callback(null, rights);
                }
            });
        }
    });
}

function RightObject(group, rights) {

    this._group = group;
    this._rights = rights;

}

RightObject.prototype.toJSON = function () {
    var toReturn = {
        group: this._group,
        rights: {}
    };

    for(var i in this._rights) {
        toReturn.rights[i] = {};
        for(var j in this._rights[i]) {
            toReturn.rights[i][j] = getRights(this._rights[i][j]);
        }
    }

    return toReturn;
};

function getRights(number) {
    return {
        read: (number & Rights.READ) !== 0,
        write: (number & Rights.WRITE) !== 0,
        attach: (number & Rights.ATTACH) !== 0,
        child: (number & Rights.CHILD) !== 0,
        manager: (number & Rights.MANAGER) !== 0,
        admin : (number & Rights.ADMIN) !== 0
    }
}