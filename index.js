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

app.get( '/get/ratings', function( req, res ) {
		var watermarkFrom = req.query.watermark;
		getRatingsFromWatermark(watermarkFrom, 
			function(data) { res.send(data); });
    });

app.get( '/get/allratings', function( req, res ) {
		getAllRatings( function(data) { res.send(data) });
	});
	
app.post( '/post/newrating', function( req, res ) {
		var rating = {id: req.body.id, rating: req.body.rating};
		addRating(rating, function(watermark) {
			res.send( { id:rating.id, rating:rating.rating, watermark:watermark });
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
var db = new sqlite3.Database(':memory:');
var insertJournalQuery, selectJournalQuery, updateRatingQuery, selectRatingQuery;
var nIDs = 200;
db.serialize(function() {
	db.run('CREATE TABLE journal (id INTEGER, rating INTEGER)');
	db.run('CREATE TABLE ratings (id INTEGER UNIQUE NOT NULL, r1, r2, r3, r4, r5)');
	insertJournalQuery = db.prepare('INSERT INTO journal (id, rating) VALUES ($id, $rating)');
	updateRatingQuery = db.prepare('UPDATE ratings SET r1=r1+?1, r2=r2+?2, r3=r3+?3, r4=r4+?4, r5=r5+?5 WHERE id=?6');
	selectJournalQuery = db.prepare('SELECT id, rating FROM journal WHERE rowid >= $watermark');
	selectRatingQuery = db.prepare('SELECT * from ratings');
	
	// Create ratings table
	var stmt = db.prepare('INSERT INTO ratings VALUES (?, 0, 0, 0, 0, 0)');
	for ( var i = 1; i < nIDs; i++ ) {
		stmt.run(i);
	}
	});

 
/**
 * This is the business logic for dealing with storing ratings.
 */
var lastWatermark;
function getRatingsFromWatermark( watermarkFrom, callback ) {
-	selectJournalQuery.all( {$watermark: watermarkFrom}, 
		function(err, rows) {
			callback({newWatermark: lastWatermark, changes: rows});
		});
}

function getAllRatings( callback ) {
	selectRatingQuery.all( function( err, rows ) {
			callback( {newWatermark: lastWatermark, ratings: rows} );
		});
}

function addRating( obj, callback ) {
	var t = { 6: obj.id, 1:0, 2:0, 3:0, 4:0, 5:0 };
	t[obj.rating] = 1;
	updateRatingQuery.run(t);
	insertJournalQuery.run( {$id: obj.id, $rating: obj.rating}, 
		function(data) {
			lastWatermark = this.lastID+1;
			callback(lastWatermark);
		});	
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