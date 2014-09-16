'use strict';

var Promise = require('bluebird'),
    Kind = require('./kind'),
    extend = require('extend');

var defaultOptions = {
    skip: 0,
    limit: Infinity,
    plain: true
};

var Query = function Query(target, query, options) {

    var self = this;

    this._targetModel = Kind.getSync(target);
    this._options = extend({}, defaultOptions, options);

    this._executionPromise = handleQuery({
        target: target,
        query: query
    });

};

Query.prototype.count = function (callback) {

    var self = this;
    this._executionPromise.then(function (result) {
        callback(null, result.length);
    }, callback);

};

Query.prototype.all = function (callback) {

    var self = this;

    this._executionPromise.then(function (result) {

        result = result.slice(self._options.skip, self._options.skip + self._options.limit);

        var query = self._targetModel.find({
            _id: {
                $in: result
            }
        });

        if(self._options.plain) {
            query.lean();
        }

        query.exec(callback);

    }, callback);

};

Query.prototype.exec = function(callback) {
    // TODO iterator version
};

/*
 Full complex query example

 {
 target: "entry",
 query: {
 $and: [
 {
 kind: "bp",
 query: {
 low: {$gt: 50, $lt: 100}
 }
 },
 {
 kind: "iupac",
 query: {
 value: {$regex: "benzen"}
 }
 },
 {
 target: "ir",
 query: {
 kind: "irLine",
 query: {
 value: {$gt: 3490, $lt: 3500}
 }
 }
 }
 ]
 },
 self: true,
 skip: 5,
 limit: 10
 };

 */

function handleQuery(fullQuery) {
    return new Promise(function (resolve, reject) {

        doQuery(fullQuery.target, fullQuery.query).then(resolve, reject);

    });
}

function doQuery(target, query) {

    /*
     Query can be one of :
     - basic (kind)
     - combination ($and, $or...)
     - projection (target)
     */

    if (query.kind) {
        return basicQuery(target, query);
    }

    if (query.target) {
        return new Promise(function (resolve, reject) {
            handleQuery(query).then(function (projectionResult) {
                basicQuery(target, {
                    kind: query.target,
                    query: {
                        _id: {
                            $in: projectionResult
                        }
                    }
                }, true).then(resolve, reject);
            }, reject);
        });
    }

    // Search for operator
    if (query.$and) {
        return combineQueryAnd(target, query.$and);
    }
    if (query.$or) {
        return combineQueryOr(target, query.$or);
    }
    if (query.$elseOr) {
        return combineQueryElseOr(target, query.$elseOr);
    }

    // Unable to process query
    return Promise.reject('Query could not be processed: ', JSON.stringify(query));

}

function basicQuery(target, query, forceMatch) {
    return new Promise(function (resolve, reject) {

        var kindModel = Kind.getSync(query.kind);

        var match = {
            '_an.kind': target
        };

        for (var i in query.query) {
            if (!forceMatch && i[0] === '_') {
                return reject('Forbidden field in projection query : ' + i)
            }
            match[i] = query.query[i];
        }

        kindModel.aggregate([
            {
                $match: match
            },
            {
                $project: {
                    _an: 1,
                    _id: 0
                }
            },
            {
                $unwind: '$_an'
            },
            {
                $match: {
                    '_an.kind': target
                }
            },
            {
                $group: {
                    _id: '$_an.id'
                }
            }
        ], function (err, result) {
            if (err) {
                return reject(err);
            }
            resolve(result.map(extractId))
        });

    });
}

function combineQueryAnd(target, query) {
    return new Promise(function (resolve, reject) {

        var results = new Array(query.length);
        for (var i = 0; i < query.length; i++) {
            results[i] = doQuery(target, query[i]);
        }

        Promise.all(results).then(function (results) {
            results = results.map(toIdIn);
            var targetModel = Kind.getSync(target);
            targetModel.aggregate([
                {
                    $match: { $and: results }
                },
                {
                    $project: {
                        _id: 1
                    }
                }
            ], function (err, result) {
                if (err) {
                    return reject(err);
                }
                resolve(result.map(extractId));
            });
        }, reject);

    });
}

function combineQueryOr(target, query) {
    return new Promise(function (resolve, reject) {

        var results = new Array(query.length);
        for (var i = 0; i < query.length; i++) {
            results[i] = doQuery(target, query[i]);
        }

        Promise.all(results).then(function (results) {
            results = results.map(toIdIn);
            var targetModel = Kind.getSync(target);
            targetModel.aggregate([
                {
                    $match: { $or: results }
                },
                {
                    $project: {
                        _id: 1
                    }
                }
            ], function (err, result) {
                if (err) {
                    return reject(err);
                }
                resolve(result.map(extractId));
            });
        }, reject);

    });
}

function combineQueryElseOr(target, query) {
    return new Promise(function (resolve, reject) {

        function tryNextQuery() {
            var subQuery = query.shift();
            if (subQuery) {
                doQuery(target, subQuery).then(function (result) {
                    if (result.length) {
                        resolve(result);
                    } else {
                        tryNextQuery();
                    }
                }, reject);
            } else {
                resolve([]);
            }
        }

        tryNextQuery();

    });
}

function extractId(val) {
    return val._id;
}

function toIdIn(result) {
    return {
        _id: {$in: result}
    };
}

module.exports = Query;