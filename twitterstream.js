var http = require('http'),
	https = require('https'),
	app = http.createServer(handler)
  	io = require('socket.io').listen(app),
  	url = require('url'),
  	fs = require('fs'),
  	twitter = require('ntwitter'),
  	util = require('util'),
  	iniparser = require('iniparser'),
  	async = require('async'),
  	GoogleSpreadsheet = require("google-spreadsheet"),
  	_und = require("underscore"),
  	static = require('node-static'),
  	moment = require('moment');
  	swat_tweet = require("./swat_tweet"),
  	swat_instagram = require("./swat_instagram"),
  	mongo = require('mongodb'),
  	format = require('util').format,
  	utility = require("./utility");

var twit;
var config;
var fileserver;


var MongoClient = mongo.MongoClient;
var BSON = mongo.BSONPure;

var CONFIG_FILE = './swatsocial.conf';



io.set('log level', 2); // reduce logging
load_config();


function load_config() {
	async.series([
		function(callback) {
			load_config_file(CONFIG_FILE, callback);
		}, 
		
		function(callback) {
			connect_to_db(config, callback);
		},
			
		function(callback) {
			swat_tweet.connect_to_twitter(config, callback);
		},
	
		function(callback) {
			swat_tweet.load_Twitter_search_terms(config, callback);
		},
	
		function(callback) {
			swat_tweet.start_tracking_Twitter_terms(config, callback);
		},
		
		function(callback) {
			start_server(config, callback);
		}	

	]);
}	



function load_config_file(config_file, callback) {
	iniparser.parse(config_file, function(err,data) {
		config = data;
		utility.update_status("Opened config file");
		callback(err, config);
	});
}

function start_server(config_file, callback) {
	fileServer = new static.Server('./public', { cache: 1 });
	app.listen(config.app.port);
	utility.update_status("Started server");
	callback(null, config);
}



function connect_to_db(config, callback) {

	utility.update_status("Connecting to database");
	MongoClient.connect('mongodb://127.0.0.1:27017/swatsocial', function(err, db) {
		if(err) {utility.update_status("Can't connect to database: " + err);}

		config.db = db;
		callback(err, config);   
	});

}




function handler (request, response) {

	utility.update_status(request.url);
	var data = "";
	
	if (request.method == "GET") {
		if (request.url.indexOf("/instagram_subscription") == 0) {
	
			// If this is an instagram callback, just send back the hub challenge
			var url_parts = url.parse(request.url, true);
			var query = url_parts.query;
			// Check to see if this is a callback challenge
			if (typeof query["hub.challenge"] != undefined) {
				response.writeHead(200, {"Content-Type": "text/plain"});
				response.write(query["hub.challenge"]);
				response.end();
			}
			
		} else {
			fileServer.serve(request, response);
		}
		
	} else if (request.method == "POST") {
	
		// Is this an Instagram post?  If so, collect the data
		if (request.url.indexOf("/instagram_subscription") == 0) {
		
			// Save POST data as it arrives
			request.on("data", function(chunk) {
				data += chunk;
			});
			
			// When Instagram request is done, acknowledge it
			request.on("end", function() { 
				utility.update_status(data);
				
				data = JSON.parse(data);		// Convert to JSON
				
				swat_instagram.instagram_handler(config, data);
				
				/*
				data.every(function(element, index, array) {
					utility.update_status("Instagram update for " + element.object + ": " + element.object_id);
				});
				*/
				
				response.writeHead(200, {"Content-Type": "text/plain"});
				response.write("Instagram post received");
				response.end(); 
			});	
			// End of handling Instagram posts
			
		} else {
		
			// We don't know how to handle this type of request
			response.writeHead(501, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ message: 'not implemented' }));	
		}
	}
}

io.sockets.on('connection', function(socket) {

	utility.update_status("Got a socket connection");
		
	// Send last posts to client
	last_posts(10, function(post) {
		socket.emit(post.type, post);
	});
	
		
	socket.on('load_history', function (data) {
		utility.update_status("Client requested history");
			// Send last posts to client
			last_posts(10, function(post) {
				socket.emit(post.type, post);	
			});
	});		

	socket.on('load_previous_posts', function (data) {
		utility.update_status("Client requested " + data.limit + " previous posts, starting from " + data.id);
			// Send previous posts to client
			previous_posts(data, function(post) {
				post.type += "_previous";
				socket.emit(post.type, post);	
			});
	});	

		
		
	socket.on('reload_search_terms', function (data) {
		utility.update_status("Re-loading configs");
		load_config();
	});
});





// Get the last n posts
function last_posts(n, callback) {

	utility.update_status("Retrieving last " + n + " posts");
	config.db.collection('posts').find({}).sort({unixtime:-1}).limit(n).toArray(
	function(err, docs) {
		docs.reverse(); // Want most recent sent last
		docs.forEach(function(doc) {
			callback(doc);
		});
    });

}




// Get the last n posts
function previous_posts(data, callback) {

	utility.update_status("Retrieving " + data.limit + " posts, starting at post ID "  + data.id);
	var o_id = new BSON.ObjectID(data.id);
	config.db.collection('posts').find({ _id: { $lt: o_id } }).sort({_id:-1}).limit(data.limit).toArray(
	function(err, docs) {
		docs.forEach(function(doc) {
			callback(doc);
		});
    });

}






/*
// ERROR HANDLING
// catch the uncaught errors that weren't wrapped in a domain or try catch statement
// do not use this in modules, but only in applications, as otherwise we could have multiple of these bound
process.on('uncaughtException', function(err) {
    // handle the error safely
    utility.update_status("ERROR:");
    utility.update_status(err);
});
*/