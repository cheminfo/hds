'use strict';

const Kind = require('./kind');
const extend = require('extend');

var customOperators = {};

var defaultOptions = {
    skip: 0,
    limit: Infinity,
    plain: true,
    log: false,
    sort: false
};

var Query = function Query(target, query, options) {

    this._targetModel = Kind.getSync(target);
    this._options = extend({}, defaultOptions, options);
    this._logs = [];

    this._executionPromise = null;
    this._target = target;
    this._query = query;
    this._executed = false;

};

Query.prototype._exec = function () {
    if (this._executed) {
        return;
    }
    this._executionPromise = handleQuery({
        target: this._target,
        query: this._query
    }, this._logs);
    this._executed = true;
};

Query.prototype._log = function (result) {
    if (this._options.log) {
        return {
            result: result,
            logs: this._logs
        };
    } else {
        return result;
    }
};

Query.prototype.count = function () {

    this._exec();

    var self = this;
    return this._executionPromise.then(function (result) {
        return self._log(result.length);
    });

};

Query.prototype.all = function () {

    this._exec();

    var self = this;
    return this._executionPromise.then(function (result) {

        result = result.slice(self._options.skip, self._options.skip + self._options.limit);

        var query = self._targetModel.find({
            _id: {
                $in: result
            }
        });

        if (self._options.sort) {
            query.sort(self._options.sort);
        }

        if (self._options.plain) {
            query.lean();
        }

        return query.exec().then(function (res) {
            return self._log(res);
        });

    });

};

Query.prototype.exec = function () {
    throw new Error('Unimplemented exec');
    // TODO iterator version
};

Query.createOperator = function (name, method) {
    if (name[0] !== '$') {
        name = '$' + name;
    }
    if (customOperators[name]) {
        throw new Error('There is already an operator with name ' + name);
    }
    if (typeof method !== 'function') {
        throw new Error('Provided operator is not a function');
    }
    if (method.length < 2) {
        throw new Error('Operators require at least two parameters (target and query)');
    }
    customOperators[name] = method;
};

Query.apply = function (query, model) {
    return new Promise(function (resolve, reject) {

        var prom;
        if (typeof model === 'string') {
            prom = Kind.get(model);
        } else {
            prom = Promise.resolve(model);
        }

        prom.then(function (kindModel) {

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

function handleQuery(fullQuery, logs) {
    return doQuery(fullQuery.target, fullQuery.query, logs);
}

function doQuery(target, query, logs) {

    /*
     Query can be one of :
     - basic (kind)
     - combination ($and, $or...)
     - projection (target)
     */

    var prom,
        type,
        logs2 = [];
    var time = Date.now();

    if (query.kind) {
        prom = basicQuery(target, query);
        type = 'basic';
    }

    if (query.target) {
        prom = handleQuery(query, logs2).then(function (projectionResult) {
            return basicQuery(target, {
                kind: query.target,
                query: {
                    _id: {
                        $in: projectionResult
                    }
                }
            }, true);
        });
        type = 'complex';
    }

    // Search for operator
    for (var i in query) {
        if (i[0] === '$' && customOperators[i]) {
            prom = customOperators[i](target, query[i], logs2);
            type = i;
        }
    }


    if (prom) {
        return prom.then(function (result) {
            logs.push({
                type: type,
                target: target,
                query: query,
                time: Date.now() - time,
                total: result.length,
                logs: logs2
            });
            return result;
        });
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

function combineQueryAnd(target, query, logs) {
    return new Promise(function (resolve, reject) {

        var results = new Array(query.length);
        for (var i = 0; i < query.length; i++) {
            results[i] = doQuery(target, query[i], logs);
        }

        Promise.all(results).then(function (results) {
            results = results.map(toIdIn);
            var targetModel = Kind.getSync(target);
            targetModel.aggregate([
                {
                    $match: {$and: results}
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

function combineQueryOr(target, query, logs) {
    return new Promise(function (resolve, reject) {

        var results = new Array(query.length);
        for (var i = 0; i < query.length; i++) {
            results[i] = doQuery(target, query[i], logs);
        }

        Promise.all(results).then(function (results) {
            results = results.map(toIdIn);
            var targetModel = Kind.getSync(target);
            targetModel.aggregate([
                {
                    $match: {$or: results}
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

function combineQueryElseOr(target, query, logs) {
    return new Promise(function (resolve, reject) {

        function tryNextQuery() {
            var subQuery = query.shift();
            if (subQuery) {
                doQuery(target, subQuery, logs).then(function (result) {
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

function projectQuery(target, query) {
    throw new Error('Unimplemented project entry')
} // TODO handle project query

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
