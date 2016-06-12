"use strict";
module.exports = {
    makeDBPool: makeDBPool,
    createDB: createDB
}

var sqlite3 = require('sqlite3');
var Pool = require('generic-pool').Pool;
var Promise = require('promise');
var cbf = require('./cbfAccess.js');
var pkg = require('./package.json')

function makeDBPool() {
    return new Pool({
        name        : 'dbpool',
        create      : function(callback) { callback(null, new dbConnection()); },
        destroy     : function(obj) { obj.close(); },
        max         : 1,
        min         : 1,
        validate    : function(obj) { return !obj.InUse; },
        idleTimeoutMillis : 5000,
    });
}

function createDB(callback) {
    cbf.getDatabaseFromGcloud().then( function(fileExists) {
        var connection = new sqlite3.Database(pkg.production.db_location);
        connection.serialize(function() {
            connection.run('CREATE TABLE IF NOT EXISTS beers (beerUUID TEXT UNIQUE NOT NULL, name, brewery, r1, r2, r3, r4, r5, PRIMARY KEY (beerUUID) ON CONFLICT IGNORE)');
            connection.run('CREATE TABLE IF NOT EXISTS journal (user INTEGER NOT NULL, beerID INTEGER NOT NULL, rating INTEGER NOT NULL, time NOT NULL, FOREIGN KEY(beerID) REFERENCES beers(rowid))');
            connection.run('CREATE TABLE IF NOT EXISTS user_rating (user INTEGER NOT NULL, beerID INTEGER NOT NULL, rating INTEGER NOT NULL, FOREIGN KEY(beerID) REFERENCES beers(rowid), PRIMARY KEY (user, beerID) ON CONFLICT REPLACE)', callback);        
        });
    });
}

class dbConnection {
    constructor() {
        this.InUse = false;
        this.Connection = new sqlite3.Database(pkg.production.db_location);            
        this.insertJournalEntry = this.Connection.prepare("INSERT INTO journal (user, beerID, rating, time) VALUES ($user, (SELECT rowid FROM beers WHERE beerUUID = $beerUUID), $rating, date('now'))");
        this.updateBeerRatings = this.Connection.prepare('UPDATE beers SET r1=r1+?1, r2=r2+?2, r3=r3+?3, r4=r4+?4, r5=r5+?5 WHERE beerUUID=?6');
        this.selectUserBeerRating  = this.Connection.prepare('SELECT rating from user_rating JOIN beers ON beerID = beers.rowid WHERE user = $user AND beerUUID = $beerUUID');
        this.setUserBeerRating = this.Connection.prepare('REPLACE INTO user_rating (user, beerID, rating) VALUES ($user, (SELECT rowid FROM beers WHERE beerUUID = $beerUUID), $rating)');
        this.beginStatement = this.Connection.prepare('BEGIN IMMEDIATE TRANSACTION'); 
        this.commitStatement = this.Connection.prepare('COMMIT TRANSACTION');
        this.rollbackStatement = this.Connection.prepare('ROLLBACK TRANSACTION');
    }

    close() {
        console.log('ABOUT TO CLOSE')
        this.insertJournalEntry.finalize((err) => {if (err) console.log('CLOSE ' + err)});
        this.updateBeerRatings.finalize((err) => {if (err) console.log('CLOSE ' + err)});
        this.selectUserBeerRating.finalize((err) => {if (err) console.log('CLOSE ' + err)});
        this.setUserBeerRating.finalize((err) => {if (err) console.log('CLOSE ' + err)});
        this.beginStatement.finalize((err) => {if (err) console.log('CLOSE ' + err)});
        this.commitStatement.finalize((err) => {if (err) console.log('CLOSE ' + err)});
        this.rollbackStatement.finalize((err) => {if (err) console.log('CLOSE ' + err)});
        this.Connection.close( (err) => {if (err) console.log('CLOSE ' + err)} );
    }
    
    begin() {
        var self = this;
        return new Promise( function( resolve, reject ) {
            self.beginStatement.run( (err) => {
                if (err) { 
                    console.log('BEGIN ERROR ' + err);
                    reject(err);
                } else {
                    resolve(null);
                }
            });
            self.InUse = true;
        });
    }
    
    commit() {
        var self = this;
        return new Promise( function( resolve, reject ) {
            self.commitStatement.run( (err) => {
                self.InUse = false;
                if (err) { 
                    console.log('COMMIT ERROR ' + err);
                    reject(err);
                } else {
                    resolve(null);
                }
            });
        });
    }
    
    rollback() {
        var self = this;
        return new Promise( function( resolve, reject ) {
            self.rollbackStatement.run( (err) => {
                self.InUse = false;
                if (err) { 
                    console.log('ROLLBACK ERROR ' + err);
                    reject(err);
                } else {
                    resolve(null);
                }
            });
        });
    }
}