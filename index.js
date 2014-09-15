var _ = require("underscore");
var express = require('express');
var logger = require('morgan');
var bodyParser = require('body-parser')

var recentRatings = [];
var currentWatermark = 0;

var app = express();
app.use( bodyParser.json() );
app.use( bodyParser.urlencoded() );

// Everything under /static is served by this route - particularly
// the test server
app.use('/static', express.static( __dirname + '/static' ));
app.use( logger('combined') );

app.get( '/get/ratings', function( req, res ) {
		var watermarkFrom = req.query.watermark || 0;
		res.send(onRequestUpdate(watermarkFrom));
    });

app.post( '/post/newrating', function( req, res ) {
		onNewRating(req.body.id, req.body.rating);
		res.send(req.body);
	});

app.get( '/post*', function( req, res ) {
		console.log('GET', req.query);
		res.send(req.query);
	});
app.post( '/post*', function( req, res ) {
		console.log('POST', req.body);
		res.send(req.body);
	});


app.listen(3000);

function onRequestUpdate( watermarkFrom ) {
	var recent = _.filter(recentRatings, 
		function(aRating) {
			return aRating ? aRating.Watermark >= watermarkFrom : false; 
		});	 
	updateCurrentWatermarkIfNeeded();
	return { NewWatermark: currentWatermark, Changes: recent };
}

function updateCurrentWatermarkIfNeeded() {
	if ( recentRatings.length > 0 && 
		 _.last(recentRatings).Watermark === currentWatermark ) {
		currentWatermark = currentWatermark + 1;
	}
}

function onNewRating( id, rating ) {
	// Add new rating to the list of recent ratings 
	recentRatings[recentRatings.length] = 
		{ Watermark: currentWatermark,
		  ID : id, 
		  Rating: rating };	
}