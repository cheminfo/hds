var hds = require('hds'),
    Kind = hds.Kind,
    Query = hds.Query,
    actelion = require('./actelion'),
    Chemcalc = require('chemcalc').Chemcalc,
    extend = require('extend');

Kind.create('entry', {
    cId: String
});

Kind.create('iupac', {
    val: {
        type: String,
        index: 1
    },
    lang: {
        type: String,
        'default': 'en'
    }
});

Kind.create('mf', {
    mf: String,
    mw: {
        type: Number,
        index: 1
    },
    em: Number,
    cmf: String
}, {
    preSave: function (next) {
        if (this.isModified('mf')) {
            var result = Chemcalc.analyseMF(this.mf);
            if (result.error) {
                return next(new Error('Incorrect MF ('+this.mf+'): ' + result.error));
            }
            this.mw = result.mw;
            this.em = result.em;
            this.cmf = result.mf;
            next();
        }
    }
});

var uniqueMolSchema = new hds.Schema({
    molId: {        // Actelion ID
        type: String,
        index: 'hashed'
    },
    mf: String,     // Molecular formula
    mw: {           // Mass weight
        type: Number,
        index: 1
    },
    em: Number,     // Exact mass
    acc: Number,    // Acceptor count
    don: Number,    // Donor count
    logP: Number,   // LogP
    logS: Number,   // LogS
    psa: Number,    // Polar surface area
    rot: Number,    // Rotatable bond count
    ste: Number,    // Stereo center count
    idx: [Number],  // List of 'on' bits for substructure search
    idxL: {         // Size of the idx list
        type: Number,
        index: 1
    }
});
// custom_uniqueMol
var uniqueMolModel = hds.customCollection('uniqueMol', uniqueMolSchema);

// kind_mol
Kind.create('mol', {
    mol: String,
    molId: {
        type: hds.Schema.Types.ObjectId,
        index: 1
    }
}, {
    preSave: function (next) {
        var self = this;
        if (this.isModified('mol')) {
            var actMol = actelion.Molecule.fromMolfile(this.mol);
            var idcode = actMol.iDCode;
            if (idcode === 'd@') {
                return next(new Error('Invalid or empty molfile'));
            }
            uniqueMolModel.findOne({
                molId: idcode
            }, function (err, result) {
                if (err) {
                    return next(err);
                }
                if (result) {
                    self.molId = result._id;
                    next();
                } else {
                    var mf = actMol.molecularFormula.formula;
                    var resultMf = Chemcalc.analyseMF(mf);
                    var props = actMol.properties;
                    var index = getIndex(actMol.index);
                    var newUniqu = new uniqueMolModel({
                        molId: idcode,
                        mf: resultMf.mf,
                        mw: resultMf.mw,
                        em: resultMf.em,
                        acc: props.acceptorCount,
                        don: props.donorCount,
                        logP: props.logP,
                        logS: props.logS,
                        psa: props.polarSurfaceArea,
                        rot: props.rotatableBondCount,
                        ste: props.stereoCenterCount,
                        idx: index,
                        idxL: index.length
                    });
                    newUniqu.save(function (err) {
                        if (err) {
                            return next(err);
                        }
                        self.molId = newUniqu._id;
                        next();
                    });
                }
            });
        }
    },
    postRemove: function () {
        var molId = this.molId;
        this.constructor.count({
            molId: molId
        }, function (err, result) {
            if (err) {
                return;
            }
            if (result === 0) {
                uniqueMolModel.findOneAndRemove({
                    molId: molId
                }).exec();
            }
        });
    }
});

var defaultSSS = {
    screeningLimit: 10000,
    limit: 1000
};

Query.createOperator('sss', function (target, query, logs) {
    return new Promise(function (resolve, reject) {

        var time1 = Date.now();

        if (target !== 'mol') {
            return reject('$sss operator is only applicable to the mol kind');
        }

        if(!query) {
            return reject('Missing $sss query object');
        }

        query = extend({}, defaultSSS, query);

        var mol;
        if(query.smiles) {
            mol = actelion.Molecule.fromSmiles(query.smiles);
        } else if(query.molfile) {
            mol = actelion.Molecule.fromMolfile(query.molfile);
        } else if(query.idcode) {
            mol = actelion.Molecule.fromIDCode(query.idcode, true);
        }

        if(!mol) {
            return reject('Could not understand $sss query');
        }

        if(mol.iDCode === 'd@') {
            return reject('Invalid molecule');
        }

        var indexToSearch = getIndex(mol.index);

        var aggregation = uniqueMolModel.aggregate();

        aggregation
            .match({
                idxL: {
                    $gte: indexToSearch.length
                }
            })
            .project({
                _id: 1,
                molId: 1,
                sub: { $setIsSubset: [ indexToSearch, '$idx' ] }
            })
            .match({
                sub: true
            });

        if(query.screeningLimit) {
            aggregation.limit(query.screeningLimit)
        }

        aggregation.project({
            _id: 1,
            molId: 1
        });
        aggregation.exec(
            function (err, result) {
                if (err) {
                    return reject(err);
                }
                var time2 = Date.now();
                logs.push({
                    step: 'screening',
                    time: time2-time1,
                    count: result.length
                });
                var l = result.length;
                if(result.length) {
                    var searcher = new actelion.SSSearch();
                    mol.setFragment(true);
                    searcher.setFragment(mol);

                    var matches = [],
                        candidate, candMol;
                    for(var i = 0; i < l; i++) {
                        candidate = result[i];
                        candMol = actelion.Molecule.fromIDCode(candidate.molId);
                        searcher.setMolecule(candMol);
                        if(searcher.isFragmentInMolecule()) {
                            matches.push(candidate._id);
                            if(query.limit && query.limit === matches.length) {
                                break;
                            }
                        }
                    }

                    logs.push({
                        step: 'sss',
                        time: Date.now() - time2,
                        count: matches.length
                    });

                    Query.apply({
                        molId: { $in: matches }
                    }, target).then(resolve, reject);

                } else {
                    resolve([]);
                }
            }
        );

    });
});

function getIndex(arr) {
    var bool = [];
    for (var i = 0; i < 512; i++) {
        if (arr[i / 32 | 0] & (1 << (31 - i % 32))) {
            bool.push(i);
        }
    }
    return bool;
}