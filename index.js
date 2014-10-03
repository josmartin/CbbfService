"use strict";
var express = require('express');
var logger = require('morgan');
var bodyParser = require('body-parser')
var sqlite3 = require('sqlite3').verbose();

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

app.get( '/endpoints/beer.service', function( req, res ) {
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
		var userID = req.query.userID;
		getUserRatings( userID, function(output) { 
			res.send(output) 
		});
	});
	
	
app.post( '/post/newrating', function( req, res ) {
		var body = req.body;
		if  (!( "id" in body && "rating" in body && "user" in body)) {
			res.send({});
		}
		addRating(body, function(watermark) {
			res.send( { id:body.id, rating:body.rating, watermark:watermark });
		});
	});

app.post( '/post/testData', function( req, res ) {
		testDatabase();
		res.send(req.body);
	});

// Only log unexpected requests - below the ones above that 
// we currently expect.
app.use( logger('combined') );
	
app.get( '/post*', function( req, res ) {
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
var	selectUserBeerRating, replaceUserBeerRating, selectUserRatings;
var nIDs = 20;
db.serialize(function() {
	db.run('CREATE TABLE IF NOT EXISTS journal (id INTEGER NOT NULL, rating INTEGER NOT NULL)');
	db.run('CREATE TABLE IF NOT EXISTS ratings (id INTEGER UNIQUE NOT NULL, r1, r2, r3, r4, r5)');
	db.run('CREATE TABLE IF NOT EXISTS user_rating (user INTEGER NOT NULL, id INTEGER NOT NULL, rating INTEGER NOT NULL, PRIMARY KEY (user, id) ON CONFLICT REPLACE)');
    
	insertJournalQuery = db.prepare('INSERT INTO journal (id, rating) VALUES ($id, $rating)');
	updateRatingQuery = db.prepare('UPDATE ratings SET r1=r1+?1, r2=r2+?2, r3=r3+?3, r4=r4+?4, r5=r5+?5 WHERE id=?6');
	selectJournalQuery = db.prepare('SELECT id, rating FROM journal WHERE rowid >= $watermark');
	selectRatingQuery = db.prepare('SELECT * from ratings');
	selectUserBeerRating  = db.prepare('SELECT id, rating from user_rating WHERE user = $user AND id = $id');
	replaceUserBeerRating = db.prepare('REPLACE INTO user_rating (user, id, rating) VALUES ($user, $id, $rating)');
	selectUserRatings = db.prepare('SELECT id, rating from user_rating WHERE user = $user');
	
	// Create ratings table
    db.get('SELECT count() as num FROM ratings', function(err, data){ 
        if ( data.num !== nIDs ) {
            var stmt = db.prepare('INSERT INTO ratings VALUES (?, 0, 0, 0, 0, 0)');
            for ( var i = 0; i < nIDs; i++ ) {
                stmt.run(i);
            }
        }
    });
});

 
/**
 * This is the business logic for dealing with storing ratings.
 */
var lastWatermark = 0;
function getRatingsFromWatermark( watermarkFrom, callback ) {
-	selectJournalQuery.all( {$watermark: watermarkFrom}, 
		function(err, rows) {
            var data  = _convertDbOutputToArray(rows);
			callback({newWatermark: lastWatermark, journal: data});
		});
}

function getUserRatings( userID, callback ) { 
	selectUserRatings.all( { $user: userID}, 
		function(err, rows) {
			callback( rows );
		});
}

function _convertDbOutputToArray(rows) {
	var ratings = new Array(rows.length);
	var ids = new Array(rows.length);
	for ( var i = 0; i < rows.length; i++ ) {
		var t = rows[i];
		ratings[i] = t.rating;
		ids[i] = t.id;
	}
	return {ids:ids, ratings:ratings};
}

function getAllRatings( callback ) {
	selectRatingQuery.all( function( err, rows ) {
			var ratings = new Array(rows.length);
			var ids = new Array(rows.length);
			for ( var i = 0; i < rows.length; i++ ) {
				var t = rows[i];
				ratings[i] = [t.r1, t.r2, t.r3, t.r4, t.r5];
				ids[i] = t.id;
			}
			callback( {newWatermark: lastWatermark, ids: ids, ratings: ratings} );
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
	 * If it exists we will need to remove it from 
	 */
    db.serialize(function() {
    _beginTransaction(db);
	selectUserBeerRating.get({$user: obj.user, $id: obj.id}, function( err, row ) {
		// Return from select statement lets us know if this user and beer combination
		// has been rated before. If it has we need to undo the 
		var change = { 6: obj.id, 1:0, 2:0, 3:0, 4:0, 5:0 };
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
			journalChanges.push({$id: obj.id, $rating:-row.rating});
		}
        // New rating needs to be added to the journal and the ratings count
		change[obj.rating] += 1;
        journalChanges.push({$id: obj.id, $rating:obj.rating});
        // Replace user beer rating so we know this user has rated this beer
		replaceUserBeerRating.run( {$user: obj.user, $id: obj.id, $rating: obj.rating} );
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