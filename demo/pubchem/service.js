var hds = require('hds'),
    Query = hds.Query,
    actelion = require('./actelion'),
    async = require('async');

exports.init = function () {
    return function (callback) {
        hds.init({
            database: {
                host: 'isicsrv15.epfl.ch',
                name: 'chemicals_light'
            }
        }, function (err) {

            if (err) {
                return callback(err);
            }

            require('./hds-kinds');

            callback();

        });
    }
};

exports.run = function (message) {
    return new Promise(function (resolve, reject) {

        var myQuery;

        var accessPoint = message.path[0];
        if (!accessPoint) {

            return resolve('HDS testing service');

        } else if (accessPoint === 'sss') {

            myQuery = new Query('entry', {
                target: 'mol',
                query: {
                    $sss: {
                        screeningLimit: parseInt(message.query.screeningLimit),
                        limit: parseInt(message.query.limit),
                        smiles: message.path[1] || ''
                    }
                }
            }, {
                plain: false,
                log: true
            });
            myQuery.all(function (err, res) {
                if (err) {
                    return reject(err);
                }
                async.map(res.result, getChildren, function (err, final) {
                    if (err) {
                        return reject(err);
                    }
                    resolve({
                        result: final,
                        logs: res.logs
                    });
                });
            });

        } else if (accessPoint === 'name') {

            myQuery = new Query('entry', {
                kind: 'iupac',
                query: {
                    val: new RegExp(decodeURIComponent(message.path[1]))
                }
            }, {
                plain: false,
                limit: 100,
                log: true,
                sort: 'cId'
            });
            myQuery.all(function (err, res) {
                if (err) {
                    return reject(err);
                }
                async.map(res.result, getChildren, function (err, final) {
                    if (err) {
                        return reject(err);
                    }
                    resolve({
                        result: final,
                        logs: res.logs
                    });
                });
            });

        } else if (accessPoint === 'combine') {

            var mw = parseInt(message.query.mw),
                iupac = message.query.iupac;

            if (!mw || !iupac) {
                return reject('Invalid mw or iupac')
            }

            myQuery = new Query('entry', {
                $and: [
                    {
                        kind: 'iupac',
                        query: {
                            val: new RegExp(iupac)
                        }
                    },
                    {
                        kind: 'mf',
                        query: {
                            mw: {
                                $lte: mw + 1,
                                $gte: mw - 1
                            }
                        }
                    }
                ]

            });
            myQuery.count(function (err, res) {
                if (err) {
                    return reject(err);
                }
                resolve(res);
            });
        }
    });
};

function getChildren(entry, callback) {
    entry.getChildren({
        groupKind: true
    }, function (err, res) {
        if (err) {
            return callback(err);
        }
        var plainEntry = entry.toObject();
        plainEntry.children = res;
        callback(null, plainEntry);
    });
}