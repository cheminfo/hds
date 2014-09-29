var mongoose = require('mongoose'),
    util = require('./util');

var groupSchema = new mongoose.Schema({
    parent: String,
    child: String,
    right: Number,
    kind: String
});

var Group = mongoose.model('Group', groupSchema, 'groups');

var Rights = {
    READ: 1,
    WRITE: 2,
    ATTACH: 4,
    CHILD: 8,
    ADMIN: 0x80000000,
    MANAGER: 0x40000000
};

exports.create = function createGroup(name, username, rights, callback) {

    var prom = new Promise(function (resolve, reject) {

        if(typeof rights === 'function') {
            callback = rights;
            rights = null;
        }

        if(rights) { // create a subGroup
            Group.findOne({
                parent: name,
                child: user,
                right: {
                    $gte: Rights.MANAGER // Admin or manager can create a subGroup
                }
            }, function (err, res) {
                if (err) {
                    reject(err);
                } else if (res) {
                    var right = 0
                        | rights.read ? Rights.READ : 0
                        | rights.write ? Rights.WRITE : 0
                        | rights.attach ? Rights.ATTACH : 0
                        | rights.child ? Rights.CHILD : 0;
                    var newGroup = new Group({
                        parent: name,
                        child: username,
                        right: right
                    });
                    newGroup.save(function(err, group) {
                        if (err) {
                            return reject(err);
                        }
                        resolve(group);
                    });
                } else {
                    reject(new Error('No group found with name "'+name+'" and user "'+username+'" or user has no right'));
                }
            });
        } else {
            Group.findOne({
                parent: name
            }, function (err, res) {
                if (err) {
                    reject(err);
                } else if (res) {
                    reject(new Error('The group "'+name+'" already exists'));
                } else {
                    var newGroup = new Group({
                        parent: name,
                        child: username,
                        right: Rights.ADMIN
                    });
                    newGroup.save(function(err, group) {
                        if (err) {
                            return reject(err);
                        }
                        resolve(group);
                    });
                }
            });
        }

    });
    return util.bindPromise(prom, callback);

};

exports.getRights = function (group) {

    /*
    TODO
     http://en.wikipedia.org/wiki/Iterative_deepening_depth-first_search
     */

};