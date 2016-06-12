"use strict";
var pkg = require('./package.json');

// What environment are we running in?
var env = process.env.NODE_ENV || 'development';

module.exports = {
    dbLocation: pkg[env].db_location,
    port: pkg[env].port,
    dbSaveInterval: pkg[env].db_saveInterval
};