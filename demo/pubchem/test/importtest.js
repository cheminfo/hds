var hds = require('hds'),
    Kind = hds.Kind,
    Entry = hds.Entry,
    fs = require('fs'),
    actelion = require('./../actelion'),
    Chemcalc = require('chemcalc').Chemcalc,
    path = require('path'),
    zlib = require('zlib'),
    async = require('async');

var sdfFields = [
    'PUBCHEM_COMPOUND_CID',
    'PUBCHEM_IUPAC_OPENEYE_NAME',
    'PUBCHEM_IUPAC_CS_NAME',
    'PUBCHEM_IUPAC_NAME',
    'PUBCHEM_IUPAC_SYSTEMATIC_NAME',
    'PUBCHEM_IUPAC_TRADITIONAL_NAME',
    'PUBCHEM_MOLECULAR_FORMULA'
];

hds.init(function () {

    require('./../hds-kinds');

    var file = 'Compound_000000001_000025000.sdf.gz';
    var dataFolder = '/home/mzasso/node/pubchem-hds/data/gz/';
    var inputFile = dataFolder+file;

    fs.readFile(inputFile, function (err, content) {

        if(err) {
            return console.log({
                error: 'could not read gz file',
                file: file
            });
        }

        zlib.gunzip(content, function (err, sdfContent) {

            if(err) {
                return console.log({
                    error: 'could not unzip file',
                    file: file
                });
            }

            try {
                var sdf = new actelion.SDFileParser(sdfContent.toString(), sdfFields);
            } catch(e) {
                return console.log({
                    error: 'could not parse sdf',
                    file: file
                });
            }

            var i = 0,
                data = [],
                elem;
            try {
                while(sdf.next()) {
                    i++;
                    elem = {
                        kind: 'entry',
                        value: {
                            cId: sdf.getFieldData(0)
                        },
                        children: [
                            {
                                kind: 'mf',
                                value: {
                                    mf: sdf.getFieldData(6).replace(/([+-][0-9]+$)/, '($1)')
                                }
                            },
                            {
                                kind: 'iupac',
                                value: {
                                    val: sdf.getFieldData(1)
                                }
                            },
                            {
                                kind: 'iupac',
                                value: {
                                    val: sdf.getFieldData(2)
                                }
                            },
                            {
                                kind: 'iupac',
                                value: {
                                    val: sdf.getFieldData(3)
                                }
                            },
                            {
                                kind: 'iupac',
                                value: {
                                    val: sdf.getFieldData(4)
                                }
                            },
                            {
                                kind: 'iupac',
                                value: {
                                    val: sdf.getFieldData(5)
                                }
                            },
                            {
                                kind: 'mol',
                                value: {
                                    mol: sdf.getMolfile()
                                }
                            }
                        ]
                    };
                    data.push(elem);
                }
            } catch(e) {
                return console.log({
                    error: 'problem reading sdf. Was parsing element '+i,
                    file: file
                }, e);
            }

            console.log(i+' elements')

            i = 0;
            var foundError;
            async.eachSeries(data, function (elem, callback) {
                i++;
                Entry.insertTree(elem, function (err) {
                    if(err) {
                        foundError = true;
                        console.log('Error on element '+i, err)
                    }
                    callback();
                });
            }, function () {
                fs.rename(inputFile, err ? path.join(dataFolder, 'gz-error', file) : path.join(dataFolder, 'gz-treated', file), function () {
                    if(err) {
                        console.log({
                            error: 'problem inserting the data',
                            file: file,
                            total: i-1
                        });
                    } else {
                        console.log({
                            finished: true,
                            file: file,
                            total: i
                        });
                    }
                });
            });

        });

    });

});