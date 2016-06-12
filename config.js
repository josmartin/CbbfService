"use strict";
var pkg = require('./package.json');
var res = require('./resources.json');

// What environment are we running in?
var env = process.env.NODE_ENV || 'development';

module.exports = {
    dbLocation: res.dataFolder + '/' + pkg[env].db_filename,
    port: pkg[env].port,
    dbSaveInterval: pkg[env].db_saveInterval,
    dbFilename: pkg[env].db_filename,
    gae: {
        inCloudShell: 'DEVSHELL_PROJECT_ID' in process.env,
        inGAE: 'GAE_LONG_APP_ID' in process.env || 'IN_GAE' in process.env || 'DEVSHELL_PROJECT_ID' in process.env,
    },
    gcloud: {
        projectID: getProjectID(),
        cbbfBucket: res.gcloud.cbbfBucket
    }
};

function getProjectID() {
    if ( 'GAE_LONG_APP_ID' in process.env ) {
        return process.env.GAE_LONG_APP_ID;
    }
    if ( 'DEVSHELL_PROJECT_ID' in process.env ) {
        return process.env.DEVSHELL_PROJECT_ID;
    }
    return res.gcloud.projectID;
}