"use strict";
module.exports = {
    makeDBPool: makeDBPool,   
}

var resources = require('./resources.json')
var sqlite3 = require('sqlite3').verbose();
var Pool = require('generic-pool').Pool;
var Promise = require('promise');

function makeDBPool() {
    return new Pool({
        name        : 'dbpool',
        create      : function(callback) { callback(null, new dbConnection()); },
        destroy     : function(obj) { obj.close(); count-- },
        max         : 1,
        min         : 1,
        validate    : function(obj) { return !obj.InUse; },
        idleTimeoutMillis : 5000,
    });
}

var count = 0;

class dbConnection {
    constructor() {
        console.log('count: ' + count++);
        this.InUse = false;
        this.Connection = new sqlite3.Database(resources.db_location);            
        this.insertJournalQuery = this.Connection.prepare("INSERT INTO journal (beerID, rating, time) VALUES ((SELECT rowid FROM beers WHERE beerUUID = $beerUUID), $rating, date('now'))");
        this.updateRatingQuery = this.Connection.prepare('UPDATE beers SET r1=r1+?1, r2=r2+?2, r3=r3+?3, r4=r4+?4, r5=r5+?5 WHERE beerUUID=?6');
        this.selectUserBeerRating  = this.Connection.prepare('SELECT rating from user_rating JOIN beers ON beerID = beers.rowid WHERE user = $user AND beerUUID = $beerUUID');
        this.replaceUserBeerRating = this.Connection.prepare('REPLACE INTO user_rating (user, beerID, rating) VALUES ($user, (SELECT rowid FROM beers WHERE beerUUID = $beerUUID), $rating)');
        this.beginStatement = this.Connection.prepare('BEGIN IMMEDIATE TRANSACTION'); 
        this.commitStatement = this.Connection.prepare('COMMIT TRANSACTION');
        this.rollbackStatement = this.Connection.prepare('ROLLBACK TRANSACTION');
    }

    close() {
        console.log('ABOUT TO CLOSE')
        this.insertJournalQuery.finalize((err) => {if (err) console.log('CLOSE ' + err)});
        this.updateRatingQuery.finalize((err) => {if (err) console.log('CLOSE ' + err)});
        this.selectUserBeerRating.finalize((err) => {if (err) console.log('CLOSE ' + err)});
        this.replaceUserBeerRating.finalize((err) => {if (err) console.log('CLOSE ' + err)});
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
                    resolve(self);
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
                    resolve(resolve);
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
                    resolve(self);
                }
            });
        });
    }
}