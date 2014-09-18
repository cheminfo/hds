'use strict';

var Promise = require('bluebird'),
    Kind = require('./kind'),
    extend = require('extend'),
    util = require('./util');

var customOperators = {};

var defaultOptions = {
    skip: 0,
    limit: Infinity,
    plain: true
};

var Query = function Query(target, query, options) {

    this._targetModel = Kind.getSync(target);
    this._options = extend({}, defaultOptions, options);

    this._executionPromise = handleQuery({
        target: target,
        query: query
    });

};

Query.prototype.count = function (callback) {

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
    throw new Error('Unimplemented exec');
    // TODO iterator version
};

Query.createOperator = function(name, method) {
    if(name[0] !== '$') {
        name = '$'+name;
    }
    if(customOperators[name]) {
        throw new Error('There is already an operator with name '+name);
    }
    if(typeof method !== 'function') {
        throw new Error('Provided operator is not a function');
    }
    if(method.length !== 2) {
        throw new Error('Operators require two parameters (target and query)');
    }
    customOperators[name] = method;
};

Query.apply = function(query, model, callback) {
    var mainPromise = new Promise(function (resolve, reject) {

        var prom;
        if(typeof model === 'string') {
            prom = Kind.get(model);
        } else {
            prom = Promise.resolve(model);
        }

        prom.then(function(kindModel) {

            kindModel.aggregate([
                {
                    $match: query
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
                resolve(result.map(extractId))
            });

        }, reject);

    });
    util.bindPromise(mainPromise, callback);
    return mainPromise;
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
    return doQuery(fullQuery.target, fullQuery.query);
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
    for(var i in query) {
        if(i[0] === '$' && customOperators[i]) {
            return customOperators[i](target, query[i]);
        }
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

function projectQuery(target, query){throw new Error('Unimplemented project entry')} // TODO handle project query

function extractId(val) {
    return val._id;
}

function toIdIn(result) {
    return {
        _id: {$in: result}
    };
}

Query.createOperator('$and', combineQueryAnd);
Query.createOperator('$or', combineQueryOr);
Query.createOperator('$elseOr', combineQueryElseOr);
Query.createOperator('$project', projectQuery);

module.exports = Query;