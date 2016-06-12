"use strict";
module.exports = {
    getBeerDataFromCBF: getBeerDataFromCBF,
    getDatabaseFromGcloud: getDatabaseFromGcloud,
    uploadDatabaseToGcloud: uploadDatabaseToGcloud
}

var fs = require('fs');
var http = require('http');
var Promise = require('promise');
var gcloud = require('gcloud');
var config = require('./config.js');
var resources = require('./resources.json');

/**
* This function queries the CBBF website to get the current list of beers 
* available
*/
function getBeerDataFromCBF( onBeerDataReceived, onError ) {
    return new Promise( function( resolve, reject ) {
        http.get(resources.cbfJSONurl, (response) => {
            var str = '';

            response.on('data', function (chunk) {
                str += chunk;
            });

            response.on('end', function () {
                try {
                    var beersObject = JSON.parse(str);
                    resolve( beersObject )
                } catch (e) {
                    reject(e);
                }
            });
          
        }).on('error', (e) => {
            reject(e);
        });
    });
}

function getDatabaseFromGcloud() {
    return new Promise( function( resolve, reject ) {
        fs.stat( config.dbLocation, (err, stats) => {
            if (!(err && err.code === 'ENOENT')) {
                console.log('Local DB file (' + config.dbFilename + ') exists');
                resolve(true);
                return
            }
            var bucket = getGcloudBucket();
            var file = bucket.file(config.dbFilename);
            file.exists( (err, fileExists) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('Cloud DB file (' + config.dbFilename + ') exists: ' + fileExists);
                    if (fileExists) {
                        file.download({
                            destination: config.dbLocation
                        }, function(err) {
                            if (err) {
                                reject(err);
                            } else {
                                console.log('Downloaded cloud DB file (' + config.dbFilename + ')');
                                resolve(fileExists);
                            }
                        });                    
                    } else {
                        resolve(fileExists);
                    }
                }
            });
        });
    });
}

function getGcloudBucket() {
    var storageOptions = {projectId: config.gcloud.projectID};

    if ( !config.gae.inGAE ) {
        storageOptions.keyFilename = resources.gcloud.gcloudKeyFile
    } 
    var gcs = gcloud.storage(storageOptions);
    return gcs.bucket(config.gcloud.cbbfBucket);
}

function uploadDatabaseToGcloud() {
    return new Promise( function( resolve, reject ) {
        getGcloudBucket().upload(config.dbLocation, function(err, file, apiResponse) {
            if (err) {
                reject(err);
            } else {
                resolve(file);
            }
        }); 
    }); 
}