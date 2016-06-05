"use strict";
var express = require('express');
var logger = require('morgan');
var bodyParser = require('body-parser')
var sqlite3 = require('sqlite3')
var cors = require('cors');

// Used to access the beer list from the current CBF website. We will ensure that
// our list of available beers is up-to-date with this list.
var cbf = require('./cbfAccess.js')
// Define our database schema and connection pooling
var dbModule = require('./db.js')
var pkg = require('./package.json')

var app = express();

// Needed to enabled Cross-Origin Resource Sharing so that web-pages from 
// bedewell.com can still call the GCE service.
app.use(cors());

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

/**
 * Define all the GET requests first - these are all methods of retrieving 
 * information from the service.
 */   
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
        addRating(body, function(err, watermark) {
            if (err) {
                res.send(err);
            } else {
                res.send( { beerUUID:body.beerUUID, rating:body.rating, watermark:watermark });
            }
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

// Create shared connection for use in querying the DB
var db = new sqlite3.cached.Database(pkg.production.db_location);
var selectJournalQuery, selectRatingQuery;
var selectUserBeerRating, selectUserRatings;
var cbfObject;
var dbPool;

// Make sure that the database is correctly created. On completion we can 
// prepare some lookup queries, 
dbModule.createDB(onDBCreated);

function onDBCreated(err) {
    selectJournalQuery = db.prepare('SELECT beerID, rating FROM journal WHERE rowid > $watermark');
    selectRatingQuery = db.prepare('SELECT * from beers');
    selectUserBeerRating  = db.prepare('SELECT rating from user_rating JOIN beers ON beerID = beers.rowid WHERE user = $user AND beerUUID = $beerUUID');
    selectUserRatings = db.prepare('SELECT beerID, rating from user_rating WHERE user = $user');
    
    dbPool = dbModule.makeDBPool();
    
    // Finally get the correct watermark from the DB and start the application 
    // listening on port 3000.
    db.get('SELECT max(rowid) as lastWatermark FROM journal', function(err, row) {
        if (!err) {
            if (row.lastWatermark !== null) {
                lastWatermark = row.lastWatermark;
            } else {
                lastWatermark = 0;
            }
        }
        // Interact with this application on a production port
        app.listen(pkg.production.port);
    });
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

var lastWatermark = 0;
function getRatingsFromWatermark( watermarkFrom, callback ) {
-   selectJournalQuery.all( {$watermark: watermarkFrom}, 
        function(err, rows) {
            if (err) {
                callback(err);
                return
            }
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
            if (err) {
                callback(err);
            } else {
                callback( rows );
            }
        });
}

function getAllRatings( callback ) {
    selectRatingQuery.all( function( err, rows ) {
            if (err) {
                callback(err);
                return
            }
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
            callback(err, null);
        } else {
            addRatingOnPooledConnection(client, obj, callback);
        }
    }); 
}

function addRatingOnPooledConnection(client, obj, callback, retries) {
    retries = retries || 5;
    if (retries < 5) console.log('Retries = ' + retries);
    var beforeExit = function(err) {dbPool.release(client)};
    client.begin().then( (noerror) => {
        // We managed to get a successful lock on the database to update the 
        // ratings so start looking for an existing rating for this user and beer
        client.selectUserBeerRating.get({$user: obj.user, $beerUUID: obj.beerUUID}, function( err, row ) {
            if (err) {
                client.rollback().then( beforeExit, beforeExit );
                callback(err, null);
                return
            }
            // Return from select statement lets us know if this user and beer combination
            // has been rated before. If it has, we need to undo the 
            var change = { 6: obj.beerUUID, 1:0, 2:0, 3:0, 4:0, 5:0 };
            var journalChanges = [];
            if ( row !== undefined ) {
                // Giving the same rating again? Simply ignore since nothing needs to
                // be done.
                if ( row.rating == obj.rating ) {
                    client.rollback().then( beforeExit, beforeExit ); 
                    callback(null, lastWatermark);
                    return;
                }
                // Otherwise, old rating needs to be removed from the journal
                // and from the ratings count
                change[row.rating] += -1;
                journalChanges.push({$user: obj.user, $beerUUID: obj.beerUUID, $rating:-row.rating});
            }
            // New rating needs to be added to the journal and the ratings count
            change[obj.rating] += 1;
            journalChanges.push({$user: obj.user, $beerUUID: obj.beerUUID, $rating:obj.rating});
            
            var counter = 0;
            var firstError = null
            var afterAllQuerysAreComplete = function(err) {
                counter--;
                if (err && firstError === null) {
                    firstError = err;
                }
                if ( counter === 0 ) {
                    if ( firstError === null ) {
                        client.commit().then( beforeExit, beforeExit );
                        lastWatermark = this.lastID;
                        callback(null, lastWatermark);
                    } else {
                        client.rollback().then( beforeExit, beforeExit ); 
                        callback(firstError, null);
                    }
                }
            };
            var getNewQueryCompleteFunction = function() {
                counter++;
                return afterAllQuerysAreComplete
            };
            // Replace user beer rating so we know this user has rated this beer
            client.setUserBeerRating.run( 
                {$user: obj.user, $beerUUID: obj.beerUUID, $rating: obj.rating}, 
                getNewQueryCompleteFunction());
            // Update the ratings counts
            client.updateBeerRatings.run(change, getNewQueryCompleteFunction());
            // Insert the changes into the journal 
            for ( let journalChange of journalChanges ) {
                client.insertJournalEntry.run(journalChange, getNewQueryCompleteFunction());
            }
        });
    }, (err) => {
        // Error in BEGIN TRANSACTION
        if ( retries < 1 ) {
            beforeExit(null);
            callback(err, null);
        } else {
            setTimeout(addRatingOnPooledConnection, 100, client, obj, callback, retries-1);
        }
    });
}


function logDBError(err, text) {
    if (err) {
        text = text || '';
        console.log(err + text);
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
