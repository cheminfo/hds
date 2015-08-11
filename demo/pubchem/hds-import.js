var hds = require('hds'),
    zlib = require('zlib'),
    path = require('path'),
    fs = require('fs'),
    actelion = require('./actelion'),
    async = require('async'),
    Entry = hds.Entry;

var dataFolder = path.join(__dirname, 'data');

var sdfFields = [
    'PUBCHEM_COMPOUND_CID',
    'PUBCHEM_IUPAC_OPENEYE_NAME',
    'PUBCHEM_IUPAC_CAS_NAME',
    'PUBCHEM_IUPAC_NAME',
    'PUBCHEM_IUPAC_SYSTEMATIC_NAME',
    'PUBCHEM_IUPAC_TRADITIONAL_NAME',
    'PUBCHEM_MOLECULAR_FORMULA'
];

var replaceMf = /([+-][0-9]+$)/;

var entryOptions = {
    owner: 'pubchem@cheminfo.org'
};

hds.init({
    database: {
        name: 'chemicals2'
    }
}, function (err) {

    if (err) {
        return process.send({
            initError: err.message
        });
    }

    process.send({
        ready: true
    });

    require('./hds-kinds'); // Load kinds

    process.on('message', function (message) {

        var file = message.file;

        var inputFile = path.join(dataFolder, 'gz', file);
        fs.readFile(inputFile, function (err, content) {

            if (err) {
                return process.send({
                    error: 'could not read gz file (' + err.message + ')'
                });
            }

            zlib.gunzip(content, function (err, sdfContent) {

                if (err) {
                    return process.send({
                        error: 'could not unzip file (' + err.message + ')'
                    });
                }

                try {
                    var sdf = new actelion.SDFileParser(sdfContent.toString(), sdfFields);
                } catch (e) {
                    return process.send({
                        error: 'could not parse sdf (' + e.message + ')'
                    });
                }

                var i = 0,
                    data = [],
                    elem;

                try {
                    while (sdf.next()) {
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
                                        mf: sdf.getFieldData(6).replace(replaceMf, '($1)')
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

                        // Read all iupac names and ignore duplicates
                        var iupacs = [], iupac;
                        for (var j = 1; j <= 5; j++) {
                            iupac = sdf.getFieldData(j);
                            if (iupac && iupacs.indexOf(iupac) === -1) {
                                iupacs.push(iupac);
                            }
                        }
                        for (j = 0; j < iupacs.length; j++) {
                            elem.children.push({
                                kind: 'iupac',
                                value: {
                                    val: iupacs[j]
                                }
                            });
                        }

                        data.push(elem);
                    }
                } catch (e) {
                    return process.send({
                        error: 'problem reading sdf. Was parsing element' + i + ' (' + e.message + ')'
                    });
                }

                var total = 0;
                //data=data.slice(0,100);

                async.eachLimit(data, 100, function (elem, callback) {
                    var j = total++;
                    Entry.insertTree(elem, entryOptions, function (err) {
                        if (err) {
                            process.send({
                                insert_error: err.message,
                                id: j
                            });
                        }
                        callback();
                    });
                }, function () {
                    fs.rename(inputFile, path.join(dataFolder, 'gz-treated', file), function () {
                        process.send({
                            finished: true,
                            total: total
                        });
                    });
                });
            });
        });
    });
});