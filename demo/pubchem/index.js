var fs = require('fs'),
    path = require('path'),
    child_process = require('child_process'),
    hds = require('hds');

hds.init({
    database: {
        name: 'chemicals_light'
    }
}).then(function () {

    var logSchema = new hds.Schema({
        date: {                 // Date
            type: Date,
            'default': Date.now
        },
        file: String,           // File name
        message: String,        // Message (if code = 3 or 1)
        code: Number,           // 0:Insertion finished without error, 1:Insertion canceled by error, 2:Insertion finished with error(s), 3:Individual error, 4:Init, 5:Finish
        errcount: Number,       // number of errors (code = 2 or 5)
        element: Number,        // total elements (code = 0, 2 or 5) or element index (code = 3)
        elapsed: Number         // elapsed time (in ms) since the start of the process
    });

    logSchema.index({
        file: 1
    });

    var logModel = hds.customCollection('log_pubchem', logSchema);

    console.log('Starting pubchem import');
    var start = Date.now();
    (new logModel({
        date: start,
        code: 4
    })).save();

    var dataFolder = path.join(__dirname, 'data');

    var totalErrors = 0;
    var totalRecords = 0;

// Read contents of the gz folder -> list files to add
    var gzContents = fs.readdirSync(dataFolder+'/gz');
// Remove last file (could be incomplete)
    var ftpJson = require('./ftp-info.json'),
        lastFile = gzContents[gzContents.length-1];
    if(lastFile !== ftpJson.lastDownloaded) {
        gzContents.pop(); // Will be redownloaded
    }

    var ftpOver = true;

// Start ftp update process
    /*var ftpUpdate = child_process.fork('./ftp-update');
    ftpUpdate.on('message', function (message) {
        if(message.newfile) {
            // Add each new file to the list as it arrives
            console.log('New file from ftp: '+message.newfile);
            gzContents.push(message.newfile);
            distributeJobs();
        } else if(message.finished) {
            ftpUpdate.kill();
            ftpOver = true;
        } else if(message.error) {
            ftpUpdate.kill();
            ftpOver = true;
            console.log('ftp update process encountered an error: '+message.error);
        }
    });
    ftpUpdate.send({
        start: true,
        data: dataFolder
    });*/

    function ImportProcess(id) {
        this._id = id;
        this._working = true;
        this._currentFile = null;
        this._errors = 0;

        this._process = child_process.fork('./hds-import');

        var self = this;
        this._process.on('message', function (message) {
            if(message.ready) {
                self._working = false;
                return distributeJobs();
            } else if(message.initError) {
                self._process.kill();
                console.log('process '+self._id+' could not initialize: '+message.initError);
                return;
            }
            var log = new logModel({
                file: self._currentFile
            });
            if(message.finished) {
                totalErrors += self._errors;
                totalRecords  += message.total;
                log.element = message.total-self._errors;
                if(self._errors) {
                    log.code = 2;
                    log.errcount = self._errors
                } else {
                    log.code = 0;
                }
                console.log('process '+self._id+' finished to treat file '+self._currentFile+'. '+(message.total-self._errors)+' new structures added.');
            } else if(message.error) {
                log.code = 1;
                log.message = message.error;
                console.log('process '+self._id+' encountered an error while treating file '+self._currentFile+': '+message.error);
            } else if(message.insert_error) {
                self._errors++;
                log.code = 3;
                log.message = message.insert_error;
                log.element = message.id;
                log.save();
                //console.log('Error in process '+self._id+'. Molecule #'+message.id+' from '+self._currentFile+' ('+message.insert_error+')');
                return;
            }
            log.save();
            self._working = false;
            self._currentFile = null;
            self._errors = 0;
            distributeJobs();
        });
    }

    ImportProcess.prototype.isWorking = function () {
        return this._working;
    };

    ImportProcess.prototype.treat = function (file) {
        this._working = true;
        this._currentFile = file;
        this._process.send({
            file: file
        });
    };

    ImportProcess.prototype.kill = function () {
        this._process.kill();
    };

// Start mongoDB import processes
    var cpus = require('os').cpus();
    var numProcs = cpus.length-2;
    console.log('launching '+numProcs+' import processes');

    var processes = [];
    for(var i = 0; i < numProcs; i++) {
        processes.push(new ImportProcess(i));
    }

    distributeJobs();

    function distributeJobs() {
        var allFinished = true;
        if (processes && (totalRecords < 500000)) {
            var i, process, file;
            for (i = 0; i < numProcs; i++) {
                process = processes[i];
                if(process.isWorking()) {
                    allFinished = false;
                } else {
                    if (file = gzContents.shift()) {
                        console.log('attributing new job to process ' + i + '. File: ' + file);
                        process.treat(file);
                        allFinished = false;
                    }
                }
            }
        }
        if(allFinished && ftpOver && ((gzContents.length === 0) || totalRecords >= 500000)) {
            var end = Date.now();
            (new logModel({
                date: end,
                elapsed: end-start,
                code: 5,
                errcount: totalErrors,
                element: totalRecords
            })).save(function () {
                    hds.close(function () {
                        processes.forEach(function (process) {
                            process.kill();
                        });
                        console.log('Import finished');
                    });
                });
        }
    }
});