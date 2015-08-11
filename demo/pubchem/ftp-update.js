var fs = require('fs'),
    path = require('path'),
    jsftp = require('jsftp'),
    async = require('async');

process.on('message', function (message) {
    if(message.start) {
        start(message.data);
    }
});

var ftp = new jsftp({
    host: 'ftp.ncbi.nlm.nih.gov'
});

var PubchemDir = '/pubchem/Compound/CURRENT-Full/SDF/';
var ftpJson = path.join(__dirname, 'ftp-info.json');

function start(dataFolder) {
    console.log('Start ftp update');

    var info = JSON.parse(fs.readFileSync(ftpJson));
    var last = info.lastDownloaded;

    ftp.ls(PubchemDir+'Compound*', function(err, res){
        if(err) {
            return process.send({
                error: 'Could not connect to pubchem'
            });
        }
        var download = !last, files = [], file;
        for(var i = 0; i < res.length-1; i++) { // -1 because last file can be incomplete
            file = res[i].name.replace(/.*\//,'');
            if(download) {
                files.push(file);
            } else if (file === last) {
                download = true;
            }
        }
        async.eachSeries(files, function (file, callback) {
            var dest = dataFolder+'/gz/'+file;
            ftp.get(PubchemDir+file, dest, function (err, result) {
                if(err) {
                    callback(err);
                    fs.exists(dest, function (yes) {
                        if(yes) {
                            fs.unlink(dest, function () {
                                process.send({
                                    error: 'Could not download file '+file
                                });
                            });
                        }
                    });
                } else {
                    process.send({
                        newfile: file
                    });
                    info.lastDownloaded = file;
                    fs.writeFile(ftpJson, JSON.stringify(info), function (err) {
                        if(err) {
                            console.log('PROBLEM: could not update last downloaded file');
                        }
                        callback();
                    });
                }
            });
        }, function (err) {
            if(!err) {
                process.send({
                    finished: true
                });
            }
        });
    });

}