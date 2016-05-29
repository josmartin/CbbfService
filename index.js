"use strict";
var express = require('express');
var logger = require('morgan');
var bodyParser = require('body-parser')
var sqlite3 = require('sqlite3').verbose();
// Used to access the beer list from the current CBF website. We will ensure that
// our list of available beers is up-to-date with this list.
var cbf = require('./cbfAccess.js')
var dbModule = require('./db.js')


var app = express();
app.use( bodyParser.json() );
app.use( bodyParser.urlencoded({extended: true}) );

/**
 * Here we define all the web service routes and the overall behaviour
 * of the web service calls. The business logic for dealing with 
 * ratings is done below
 */
 
// Everything under /static is served by this route - particularly
// the test server
app.use('/static', express.static( __dirname + '/static' ));

// To allow development builds of the app to support the bedewell.com endpoint
// services framework we enable a get on the beer.service. This is ONLY useful 
// when running in development
app.get( '/endpoints/beer.service', ( req, res ) => {
        res.send('');
    });
   
app.get( '/get/ratings/journal', function( req, res ) {
        var watermarkFrom = req.query.watermark;
        getRatingsFromWatermark(watermarkFrom, function(output) { 
            res.send(output); 
        });
    });

app.get( '/get/ratings/all', function( req, res ) {
        getAllRatings( function(output) { 
            res.send(output) 
        });
    });

app.get( '/get/ratings/user', function( req, res ) {
        var user = req.query.user;
        getUserRatings( user, function(output) { 
            res.send(output) 
        });
    });
    
    
app.post( '/post/newrating', function( req, res ) {
        var body = req.body;
        if  (!( "beerUUID" in body && "rating" in body && "user" in body)) {
            res.send({});
        }
        addRating(body, function(watermark) {
            res.send( { beerUUID:body.beerUUID, rating:body.rating, watermark:watermark });
        });
    });

app.post( '/post/testData', function( req, res ) {
        testDatabase();
        res.send(req.body);
    });

// Only log unexpected requests - below the ones above that 
// we currently expect.
app.use( logger('combined') );
    
app.get( '/get*', function( req, res ) {
        console.log('GET', req.query);
        res.send(req.query);
    });
app.post( '/post*', function( req, res ) {
        console.log('POST', req.body);
        res.send(req.body);
    });

// Interact with this application on port 3000
app.listen(3000);

/**
 * Database creation
 */
var db = new sqlite3.cached.Database('data/info.db');
var selectJournalQuery, selectRatingQuery;
var selectUserBeerRating, selectUserRatings;
var cbfObject;
var dbPool;
db.serialize(function() {
    db.run('CREATE TABLE IF NOT EXISTS beers (beerUUID TEXT UNIQUE NOT NULL, name, brewery, r1, r2, r3, r4, r5, PRIMARY KEY (beerUUID) ON CONFLICT IGNORE)');
    db.run('CREATE TABLE IF NOT EXISTS journal (beerID INTEGER NOT NULL, rating INTEGER NOT NULL, time NOT NULL, FOREIGN KEY(beerID) REFERENCES beers(rowid))');
    db.run('CREATE TABLE IF NOT EXISTS user_rating (user INTEGER NOT NULL, beerID INTEGER NOT NULL, rating INTEGER NOT NULL, FOREIGN KEY(beerID) REFERENCES beers(rowid), PRIMARY KEY (user, beerID) ON CONFLICT REPLACE)', onDBCreated);
    
});

function onDBCreated(err) {
    selectJournalQuery = db.prepare('SELECT beerID, rating FROM journal WHERE rowid >= $watermark');
    selectRatingQuery = db.prepare('SELECT * from beers');
    selectUserBeerRating  = db.prepare('SELECT rating from user_rating JOIN beers ON beerID = beers.rowid WHERE user = $user AND beerUUID = $beerUUID');
    selectUserRatings = db.prepare('SELECT beerID, rating from user_rating WHERE user = $user');
    
    dbPool = dbModule.makeDBPool();
}

cbf.getBeerDataFromCBF( 
    (obj) => {
        cbfObject = obj;
        console.log('Loaded beer data from CBF website');
        ensureAllBeersExistInRatingsTable( cbfObject.producers )
    }, 
    (error) => {
        consol.log(`Got error from CBF Server: ${error.message}`);
    });

    
function ensureAllBeersExistInRatingsTable( producers ) {
    var stmt = db.prepare('INSERT INTO beers VALUES ($beerUUID, $name, $brewery, 0, 0, 0, 0, 0)');
    producers.forEach( (producer) =>  {
        producer.products.forEach( (product) => {
            stmt.run( {$beerUUID: product.id, $name: product.name, $brewery: producer.name} );
        })
    });
}

/**
 * This is the business logic for dealing with storing ratings.
 */
// TODO - on startup get the correct watermark from the database
var lastWatermark = 0;
function getRatingsFromWatermark( watermarkFrom, callback ) {
-   selectJournalQuery.all( {$watermark: watermarkFrom}, 
        function(err, rows) {
            var ratings = new Array(rows.length);
            var beerIDs = new Array(rows.length);
            for ( var i = 0; i < rows.length; i++ ) {
                var t = rows[i];
                ratings[i] = t.rating;
                beerIDs[i] = t.beerID;
            }
            callback({newWatermark: lastWatermark, journal: {beerIDs:beerIDs, ratings:ratings}});
        });
}

function getUserRatings( user, callback ) { 
    selectUserRatings.all( {$user: user}, 
        function(err, rows) {
            callback( rows );
        });
}

function getAllRatings( callback ) {
    selectRatingQuery.all( function( err, rows ) {
            var ratings = new Array(rows.length);
            var beerUUIDs = new Array(rows.length);
            var names = new Array(rows.length);
            for ( var i = 0; i < rows.length; i++ ) {
                var t = rows[i];
                ratings[i] = [t.r1, t.r2, t.r3, t.r4, t.r5];
                beerUUIDs[i] = t.beerUUID;
                names[i] = t.name;
            }
            callback( {newWatermark: lastWatermark, beerUUIDs: beerUUIDs, ratings: ratings, names: names} );
        });
}

function addRating( obj, callback ) {
    /*
     * Code structure is going to be:
     * Search user_ratings for old rating
     * If it exists we will need to remove it from the existing 
     */
    dbPool.acquire( function(err, client) {
        if (err) { 
            callback(err);
            return
        }
        client.begin();
        client.selectUserBeerRating.get({$user: obj.user, $beerUUID: obj.beerUUID}, function( err, row ) {
            // Return from select statement lets us know if this user and beer combination
            // has been rated before. If it has, we need to undo the 
            var change = { 6: obj.beerUUID, 1:0, 2:0, 3:0, 4:0, 5:0 };
            var journalChanges = [];
            if ( row !== undefined ) {
                // Giving the same rating again? Simply ignore since nothing needs to
                // be done.
                if ( row.rating == obj.rating ) {
                    callback(lastWatermark);
                    client.rollback();
                    dbPool.release(client);
                    return;
                }
                // Otherwise, old rating needs to be removed from the journal
                // and from the ratings count
                change[row.rating] += -1;
                journalChanges.push({$beerUUID: obj.beerUUID, $rating:-row.rating});
            }
            // New rating needs to be added to the journal and the ratings count
            change[obj.rating] += 1;
            journalChanges.push({$beerUUID: obj.beerUUID, $rating:obj.rating});
            // Replace user beer rating so we know this user has rated this beer
            client.replaceUserBeerRating.run( 
                {$user: obj.user, $beerUUID: obj.beerUUID, $rating: obj.rating}, logDBError);
            // Update the ratings counts
            client.updateRatingQuery.run(change, logDBError);
            // Insert the changes into the journal 
            var counter = journalChanges.length;
            for ( let journalChange of journalChanges ) {
                // NOTE: This is still part of the db.serialize as forEach on an array
                // stays within the same javascript execution block. 
                // ALSO NOTE: It is critical that the callback below be defined as a
                // function rather than => since the latter will bind in the this 
                // object so it doesn't get a lastID as a result of calling the 
                // insertJournal query.
                client.insertJournalQuery.run( journalChange , function(err) {
                    logDBError(err)
                    counter--;
                    // Only trigger callback on last query execution
                    if ( counter === 0 ) {
                        lastWatermark = this.lastID+1;
                        client.commit();
                        dbPool.release(client);
                        callback(lastWatermark);
                    }
                });
            }
        });
    }); 
}

function logDBError(err) {
    if (err) {
        console.log(err);
    }
}

function testDatabase() {
    db.serialize(function() {     
        var stmt = db.prepare("SELECT * FROM ratings");     
        stmt.all( function(err, rows) {
            console.log(rows);
        });
        stmt.finalize();
    });
}
