"use strict";
var express = require('express');
var logger = require('morgan');
var bodyParser = require('body-parser')
var sqlite3 = require('sqlite3').verbose();
// Used to access the beer list from the current CBF website. We will ensure that
// our list of available beers is up-to-date with this list.
var cbf = require('./cbfAccess.js')

var app = express();
app.use( bodyParser.json() );
app.use( bodyParser.urlencoded() );

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
        if  (!( "beer" in body && "rating" in body && "user" in body)) {
            res.send({});
        }
        addRating(body, function(watermark) {
            res.send( { beer:body.beer, rating:body.rating, watermark:watermark });
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
var insertJournalQuery, selectJournalQuery, updateRatingQuery, selectRatingQuery;
var selectUserBeerRating, replaceUserBeerRating, selectUserRatings;
var nIDs = 20;
var cbfObject;

db.serialize(function() {
    db.run('CREATE TABLE IF NOT EXISTS journal (beer TEXT NOT NULL, rating INTEGER NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS ratings (beer TEXT UNIQUE NOT NULL, name, brewery, r1, r2, r3, r4, r5, PRIMARY KEY (beer) ON CONFLICT IGNORE)');
    db.run('CREATE TABLE IF NOT EXISTS user_rating (user INTEGER NOT NULL, beer TEXT NOT NULL, rating INTEGER NOT NULL, PRIMARY KEY (user, beer) ON CONFLICT REPLACE)');
    
    insertJournalQuery = db.prepare('INSERT INTO journal (beer, rating) VALUES ($beer, $rating)');
    updateRatingQuery = db.prepare('UPDATE ratings SET r1=r1+?1, r2=r2+?2, r3=r3+?3, r4=r4+?4, r5=r5+?5 WHERE beer=?6');
    selectJournalQuery = db.prepare('SELECT beer, rating FROM journal WHERE rowid >= $watermark');
    selectRatingQuery = db.prepare('SELECT * from ratings');
    selectUserBeerRating  = db.prepare('SELECT beer, rating from user_rating WHERE user = $user AND beer = $beer');
    replaceUserBeerRating = db.prepare('REPLACE INTO user_rating (user, beer, rating) VALUES ($user, $beer, $rating)');
    selectUserRatings = db.prepare('SELECT beer, rating from user_rating WHERE user = $user');
});

cbf.getBeerDataFromCBF( 
    (obj) => {
        cbfObject = obj;
        console.log(obj);
        ensureAllBeersExistInRatingsTable( cbfObject.producers )
    }, 
    (error) => {
        consol.log(`Got error from CBF Server: ${e.message}`);
    });

    
function ensureAllBeersExistInRatingsTable( producers ) {
    var stmt = db.prepare('INSERT INTO ratings VALUES ($beer, $name, $brewery, 0, 0, 0, 0, 0)');
    producers.forEach( (producer) =>  {
        producer.products.forEach( (product) => {
            stmt.run( {$beer: product.id, $name: product.name, $brewery: producer.name} );
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
            var data  = _convertDbOutputToArray(rows);
            callback({newWatermark: lastWatermark, journal: data});
        });
}

function getUserRatings( user, callback ) { 
    selectUserRatings.all( { $user: user}, 
        function(err, rows) {
            callback( rows );
        });
}

function _convertDbOutputToArray(rows) {
    var ratings = new Array(rows.length);
    var beers = new Array(rows.length);
    for ( var i = 0; i < rows.length; i++ ) {
        var t = rows[i];
        ratings[i] = t.rating;
        beers[i] = t.beer;
    }
    return {beers:beers, ratings:ratings};
}

function getAllRatings( callback ) {
    selectRatingQuery.all( function( err, rows ) {
            var ratings = new Array(rows.length);
            var beers = new Array(rows.length);
            var names = new Array(rows.length);
            for ( var i = 0; i < rows.length; i++ ) {
                var t = rows[i];
                ratings[i] = [t.r1, t.r2, t.r3, t.r4, t.r5];
                beers[i] = t.beer;
                names[i] = t.name;
            }
            callback( {newWatermark: lastWatermark, beers: beers, ratings: ratings, names: names} );
        });
}

function _beginTransaction(db) {
    db.run('BEGIN TRANSACTION');
}

function _endTransaction(db) {
    db.run('COMMIT TRANSACTION');
}


function addRating( obj, callback ) {
    /*
     * Code structure is going to be:
     * Search user_ratings for old rating
     * If it exists we will need to remove it from the existing 
     */
    db.serialize(function() {
    _beginTransaction(db);
    selectUserBeerRating.get({$user: obj.user, $beer: obj.beer}, function( err, row ) {
        // Return from select statement lets us know if this user and beer combination
        // has been rated before. If it has, we need to undo the 
        var change = { 6: obj.beer, 1:0, 2:0, 3:0, 4:0, 5:0 };
        var journalChanges = [];
        if ( row !== undefined ) {
            // Giving the same rating again? Simply ignore since nothing needs to
            // be done.
            if ( row.rating == obj.rating ) {
                callback(lastWatermark);
                _endTransaction(db);
                return;
            }
            // Otherwise, old rating needs to be removed from the journal
            // and from the ratings count
            change[row.rating] += -1;
            journalChanges.push({$beer: obj.beer, $rating:-row.rating});
        }
        // New rating needs to be added to the journal and the ratings count
        change[obj.rating] += 1;
        journalChanges.push({$beer: obj.beer, $rating:obj.rating});
        // Replace user beer rating so we know this user has rated this beer
        replaceUserBeerRating.run( {$user: obj.user, $beer: obj.beer, $rating: obj.rating} );
        // Update the ratings counts
        updateRatingQuery.run(change);
        // Insert the changes into the journal 
        var counter = 0;
        journalChanges.forEach( function( journalChange ) {
            // NOTE: This is still part of the db.serialize as forEach on an array
            // stays within the same javascript execution block
            insertJournalQuery.run( journalChange , function(data) {
                counter++;
                // Only trigger callback on last query execution
                if ( counter == journalChanges.length ) {
                    lastWatermark = this.lastID+1;
                    callback(lastWatermark);
                }
            });
        });
        _endTransaction(db);
    });
    }); // db.serialize();
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
