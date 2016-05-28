module.exports = {
    getBeerDataFromCBF: function( onBeerDataReceived, onError ) {
        getBeerDataFromCBF_impl( onBeerDataReceived, onError );
    }
}

var http = require('http');
var resources = require('./resources.json');

/**
* This function queries the 
*/
function getBeerDataFromCBF_impl( onBeerDataReceived, onError ) {
    http.get(resources.cbfJSONurl, (response) => {
        var str = '';

        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', function () {
            try {
                var beersObject = JSON.parse(str);
                onBeerDataReceived( beersObject )
            } catch (e) {
                onError(e);
            }
        });
      
    }).on('error', (e) => {
        onError(e);
    });    
}