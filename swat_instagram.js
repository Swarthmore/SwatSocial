var arduino = require("./swat_arduino");
	https = require('https'),
	utility = require("./utility"),	
	mongo = require('mongodb'),
	GoogleSpreadsheet = require("google-spreadsheet"),
	Instagram = require('instagram-node-lib'),
	_und = require("underscore");


var BSON = mongo.BSONPure;	





var load_Instagram_search_terms = function(config, callback) {
	
	config.instagram_tags = [];
	config.instagram_locations = [];
		
	utility.update_status("Connecting to Google Doc for Instagram search parameters");
	var socialmedia_spreadsheet = new GoogleSpreadsheet(config.GoogleDoc.document_key);
	
	socialmedia_spreadsheet.getInfo( function( err, sheet_info ){

		if (err) {
			utility.update_status("Error opening Google spreadsheet: " + err);
			callback(err,config);
		}
	
		utility.update_status(sheet_info.title + ' is loaded' );
	
		// Loop through each config sheet, pulling out the configuration information	
		async.each(
		
			sheet_info.worksheets, 	// Collection to iterate over
			
			function(sheet, callback) {
				process_google_sheet(config, sheet.title, sheet, callback);
			}, 
			
			function(err){
							
				// Master list of Instagram search parameters	
				// Loop over the flavors, pulling out the Twitter search terms and follow ids
				for (var key in config.flavors) {
					config.instagram_tags = config.instagram_tags.concat(config.flavors[key].instagram_tags);
					config.instagram_locations = config.instagram_locations.concat(config.flavors[key].instagram_locations);
				}
	
				// Remove duplicate values
				config.instagram_tags = _und.uniq(config.instagram_tags);
				config.instagram_locations = _und.uniq(config.instagram_locations);

				utility.update_status("Instagram tags: " + config.instagram_tags);	
				utility.update_status("Instagram locations: " + config.instagram_locations);	

				callback(null,config);	
   
			}	// End of async.each final function
			
		); // End of async.each
		
	}); // end of socialmedia_spreadsheet.getInfo
	
} // end of load_Instagram_search_terms






// Given a flavor name and the corresponding spreadsheet, pull out all the data	
function process_google_sheet(config, flavor, spreadsheet, callback) {

	// Don't process the template
	if (flavor == "TEMPLATE") {callback();return;}

	utility.update_status("Processing \"" + spreadsheet.title + "\"");

	// Configure the flavor
	config.flavors[flavor].instagram_tags = [];
	config.flavors[flavor].instagram_locations = [];
	config.flavors[flavor].instagram_blacklist = [];

	spreadsheet.getRows(0, function(err, row_data){

		// Instagram geolocation
		if (row_data && row_data.length > 0 && ["Yes", "yes", "Y", "y", "1"].indexOf(row_data[0].instagramgeoenabled) > -1 ) {
			config.flavors[flavor].instagram_geo = true;
		} else {
			config.flavors[flavor].instagram_geo = false;
		}


		// Process each row to add terms to Instagram tag list. 
		for (var i in row_data) {
			getInstagramTermsFromRow(config, flavor, row_data[i])	
		}
	
		callback();	// For async each -- do when all done getting data from the rows
	});

		
}	
	
	
	
	

// Given a flavor and a Google spreadsheet row, pull the Twitter terms
function getInstagramTermsFromRow(config, flavor, row) {
	
	// Instagram tags
	if (row.instagramterm) {
		config.flavors[flavor].instagram_tags.push(row.instagramterm);
	}	

	// Instagram locations
	if (row.instagramlocations) {
		config.flavors[flavor].instagram_locations.push(row.instagramlocations);
	}		

	// Instagram blacklist
	if (row.instagramignore) {
		config.flavors[flavor].instagram_blacklist.push(row.instagramignore);
	}
		
}








var instagram_handler = function(config, instagram_update) {

	utility.update_status("Received an Instagram callback.");
	utility.update_status(instagram_update);
	
	// Loop through each Instagram match and get the updated information
	//instagram_update.every(function(element, index, array) {
	
	for (var j in instagram_update) {
	
		utility.update_status("Instagram update for " + instagram_update[j].object + ": " + instagram_update[j].object_id);

		// Depending on the match type, request the appropriate Instagram media		
		switch (instagram_update[j].object) {
		
			case "tag":

				console.log("******* Now ask for recent \"" + instagram_update[j].object_id + "\" tags");

				Instagram.tags.recent({ 			
					name: instagram_update[j].object_id,			
					complete: function(data, pagination){
						utility.update_status("Received recent posts for Instagram tag " + instagram_update[j].object_id);
						// Loop through each post, processing each match
						for (var i=data.length-1; i>=0; i=i-1) {
							process_Instagram_post(config, data[i], "tag");			
						}	
					},
					error: function(errorMessage, errorObject, caller){
						utility.update_status("Error retrieving Instagram tag " + instagram_update[j].object_id + "\n" + errorMessage);
					}
				});
				
				break;
			
			
			case "location":
			
				Instagram.locations.recent({ 
					location_id: instagram_update[j].object_id,		
					complete: function(data, pagination){
						// Loop through each post, processing each match
						for (var i=data.length-1; i>=0; i=i-1) {
							process_Instagram_post(config, data[i], "location");			
						}	
					},	
					error: function(errorMessage, errorObject, caller){
						utility.update_status("Error retrieving Instagram location " + instagram_update[j].object_id + "\n" + errorMessage);
					}
				});
				break;
				
			case "user":
			
				Instagram.users.recent({ 
					user_id: instagram_update[j].object_id,		
					complete: function(data, pagination){
						// Loop through each post, processing each match
						for (var i=data.length-1; i>=0; i=i-1) {
							process_Instagram_post(config, data[i], "user");			
						}	
					},	
					error: function(errorMessage, errorObject, caller){
						utility.update_status("Error retrieving Instagram user " + instagram_update[j].object_id + "\n" + errorMessage);
					}
				});
				break;
				
			case "geography":
			
				Instagram.geographies.recent({ 
					geography_id: instagram_update[j].object_id,		
					complete: function(data, pagination){
						// Loop through each post, processing each match
						for (var i=data.length-1; i>=0; i=i-1) {
							process_Instagram_post(config, data[i], "geography");			
						}	
					},	
					error: function(errorMessage, errorObject, caller){
						utility.update_status("Error retrieving Instagram geography " + instagram_update[j].object_id + "\n" + errorMessage);
					}
				});
				break;
				
			default:
				// Don't know what to look for
				utility.update_status("Can't find a matching Instagram type to return");
			}	// End of switch on instagram subscription type
		
	}	// End of loop through each instagram subscription update


}




// Take an individual Instagram post, loop through each flavor looking for a match
var process_Instagram_post = function(config, post, match_type) {

	utility.update_status("Got an Instagram post (" + post.id + ") of type " + match_type);
		
	// Loop through each flavor looking for matches
	for (var i in config.flavors) {

		console.log("Checking instagram for flavor " + i);

		var matches = [];


		// First, check to see if this user is Blacklisted for this flavor.  If so, skip to next flavor.
		if (config.flavors[i].instagram_blacklist.indexOf(post.user.username) > -1) {
			next;
		}

		// Now check to see if this matches a tag of interest for this flavor
		// See the caption text or tags match a search term
		for (var j = 0; j < config.flavors[i].instagram_tags.length; j++) {

			// Make sure tag to compare is lowercase
			var tag = config.flavors[i].instagram_tags[j].toLowerCase();

			console.log("Checking flavor \"" + i + "\" for tag \"" + tag + "\" in tag listing: \"" + post.tags.join(",") + "\"");
	
			// Strip off hashtag or @ symbols
			if (tag.charAt(0) == "@" || tag.charAt(0) == "#") {
				tag = tag.substr(1);
			}
	
			// Look to see if term is in tag listing
			if (post.tags.indexOf(tag) > -1) {
				matches.push({type:'tag', 'value': config.flavors[i].instagram_tags[j]});
			}
		}

			
			
		
		
		// Check to see if there are location matches		 	
		 if (config.flavors[i].instagram_geo && post.location && post.location.name && config.flavors[i].instagram_locations.indexOf(post.location.name) > -1) {
			matches.push({type:'location', 'value': post.location.name});
		 }
		
		if (config.flavors[i].instagram_geo && match_type == "geography") {
			matches.push({type:'geography'});
		}
				
		// If this flavor matches the Instagram post, process it.  
		if (matches.length > 0) {
		
			utility.update_status("Instagram post matches: " + matches.join() + " for flavor " + i); 
			
			var output = {};
			output.content = post;
			output.id = post.id;
			output.type = "instagram";
			output.match = matches;
			output.formatted_time = moment.unix(post.created_time).format("M/D/YYYY h:mm:ss A");
			output.unixtime = post.created_time;


			// Add the flavor to the message
			output.flavor = i;

			// Generate a new object ID first so that we can send it to the browser without having to do a lookup after insert
			output._id = new BSON.ObjectID();

			// Save Instagram to database and send out
			// (don't send out if the post has already been saved)
			// Note: there is an index on id and flavor, so the insert will fail if a duplicate entry is made
			config.db.collection('posts').insert(output, function(err, doc) {
				if (err) {
					utility.update_status("Could not save instagram post id " + output.id + " to database: " + err);
				} else {
					console.log("Saved IG to db: ");
				
					// Only send message to clients listening on this flavor
					utility.update_status("Instagram id " + doc[0].id  + " sent out out to clients");	
					io.sockets.in(doc[0].flavor).emit('instagram',doc[0]);

					// If want to use Arduino, flash lights on Arduino based on first matched attribute
					// For now, the "flash bulb" effect is hard coded into program
					if (config.flavors[doc[0].flavor].arduino_ip) {
						arduino.send_arduino_message(config.flavors[doc[0].flavor].arduino_ip, doc[0].id, "FFFFFF", "000000", "2");	
					}			

				}
			});
			
			
		} else {
			utility.update_status("Instagram post does not match anything for flavor " + i);
		}
			
	} // End looping through the flavors

}




/*
var delete_all_instagram_subscriptions = function(config) {


	// Build URL for cancelling all Instagram Real-time API subscriptions
	var hostname = 'api.instagram.com";
	var path = "/v1/subscriptions?client_secret=" + config.Instagram.instagram_client_secret + "&object=all&client_id=" + config.Instagram.instagram_client_id;
	var method = "DELETE"
	
	
	var options = {
  		hostname: hostname,
  		port: 443,
  		path: path,
  		method: method
	};

	var req = http.request(options, function(res) {
	  console.log('STATUS: ' + res.statusCode);
	  console.log('HEADERS: ' + JSON.stringify(res.headers));
	  res.setEncoding('utf8');
	});

	res.on('data', function (chunk) {
		console.log('BODY: ' + chunk);
		
		// Now that all the old subscriptions are deleted, initialize new subscriptions
		init_subscriptions(config);
		
	});

	req.on('error', function(e) {
	  console.log('problem with request to delete all Instagram subscriptions: ' + e.message);
	});

	// Make request
	req.end();
	
}
*/


// Initialize instagram subscriptions
var intialize_subscriptions = function(config, callback) {

	console.log(config.Instagram.instagram_client_id + "\n" + config.Instagram.instagram_client_secret);

	Instagram.set('client_id', config.Instagram.instagram_client_id);
	Instagram.set('client_secret', config.Instagram.instagram_client_secret);
	Instagram.set('callback_url', config.app.url +  config.Instagram.instagram_callback_path);

	console.log(Instagram.subscriptions.list());

	Instagram.subscriptions.unsubscribe_all( {
	
		complete: function(data, pagination){
		
			// Subscribe to all feeds
			for (var i in config.instagram_tags) {
				Instagram.tags.subscribe({ 
					object_id: config.instagram_tags[i],
					complete: function(data, pagination){
						// data is a javascript object/array/null matching that shipped Instagram
						// when available (mostly /recent), pagination is a javascript object with the pagination information
						console.log("Results of subscription request: ");
						console.log(data);
					},
					error: function(errorMessage, errorObject, caller){
						// errorMessage is the raised error message
						// errorObject is either the object that caused the issue, or the nearest neighbor
						// caller is the method in which the error occurred
						console.log("Error requesting subscription: " + errorMessage);
					}
			
				});	
			}

			for (var i in config.locations) {
				Instagram.locations.subscribe({ object_id: config.locations[i] });	
			}    

			// Hard code Swarthmore location for geography     
			Instagram.media.subscribe({ lat: 39.9053898, lng: -75.3538015, radius: 500 });
		
		
		} // End of unsubscribe all complete callback
	
	}); // End of unsubscribe all

	

	callback(null,config);

}



// Take a formatted instagram post object and save it to the database
var save_instagram_to_db = function(config, output) {

	config.db.collection('posts').insert(output, function(err, db) {
	
		if (err) {
		
			utility.update_status("Could not save instagram post id " + output.id + " to database: " + err);
			
		} else {
		
			utility.update_status("Saved instagram post id " + output.id + " to database");
		
		}
	});


}




exports.instagram_handler = instagram_handler;
exports.intialize_subscriptions = intialize_subscriptions;
exports.load_Instagram_search_terms = load_Instagram_search_terms;
