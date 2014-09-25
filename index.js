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
var db = new sqlite3.Database(':memory:');
var insertJournalQuery, selectJournalQuery, updateRatingQuery, selectRatingQuery;
var	selectUserBeerRating, insertUserBeerRating, selectUserRatings;
var nIDs = 20;
db.serialize(function() {
	db.run('CREATE TABLE journal (id INTEGER, rating INTEGER)');
	db.run('CREATE TABLE ratings (id INTEGER UNIQUE NOT NULL, r1, r2, r3, r4, r5)');
	db.run('CREATE TABLE user_rating (user INTEGER, id INTEGER, rating INTEGER, PRIMARY KEY (user, id) ON CONFLICT REPLACE)')
	insertJournalQuery = db.prepare('INSERT INTO journal (id, rating) VALUES ($id, $rating)');
	updateRatingQuery = db.prepare('UPDATE ratings SET r1=r1+?1, r2=r2+?2, r3=r3+?3, r4=r4+?4, r5=r5+?5 WHERE id=?6');
	selectJournalQuery = db.prepare('SELECT id, rating FROM journal WHERE rowid >= $watermark');
	selectRatingQuery = db.prepare('SELECT * from ratings');
	selectUserBeerRating  = db.prepare('SELECT * from user_rating WHERE user = $user AND id = $id');
	insertUserBeerRating  = db.prepare('REPLACE INTO user_rating (user, id, rating) VALUES ($user, $id, $rating)');
	selectUserRatings = db.prepare('SELECT id, rating from user_rating WHERE user = $user');
	
	// Create ratings table
	var stmt = db.prepare('INSERT INTO ratings VALUES (?, 0, 0, 0, 0, 0)');
	for ( var i = 1; i < nIDs; i++ ) {
		stmt.run(i);
	}
	});

 
/**
 * This is the business logic for dealing with storing ratings.
 */
var lastWatermark = 0;
function getRatingsFromWatermark( watermarkFrom, callback ) {
-	selectJournalQuery.all( {$watermark: watermarkFrom}, 
		function(err, rows) {
			callback({newWatermark: lastWatermark, changes: rows});
		});
}

function getUserRatings( userID, callback ) { 
	selectUserRatings.all( { $user: userID}, 
		function(err, rows) {
			callback( rows );
		});
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

function addRating( obj, callback ) {
	var change = { 6: obj.id, 1:0, 2:0, 3:0, 4:0, 5:0 };
	/*
	 * Code structure is going to be:
	 * Search user_ratings for old rating
	 * If it exists we will need to remove it from 
	 */
	selectUserBeerRating.get({$user: obj.user, $id: obj.id}, function( err, row ) {
		if ( row !== undefined ) {
			if ( row.rating == obj.rating ) {
				callback(lastWatermark);
				return;
			}
			change[row.rating] += -1;
		}
		change[obj.rating] += 1;
		insertUserBeerRating.run( {$user: obj.user, $id: obj.id, $rating: obj.rating} );
		updateRatingQuery.run(change);
		db.serialize(function() {
			if ( row !== undefined ) {
				insertJournalQuery.run( {$id: obj.id, $rating: -row.rating} );
			}
			insertJournalQuery.run( {$id: obj.id, $rating: obj.rating}, 
				function(data) {
					lastWatermark = this.lastID+1;
					callback(lastWatermark);
				});	
		});
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