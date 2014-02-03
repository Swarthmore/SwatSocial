var arduino = require("./swat_arduino");
	https = require('https'),
	utility = require("./utility"),	
	mongo = require('mongodb'),
	GoogleSpreadsheet = require("google-spreadsheet"),
	Instagram = require('instagram-node-lib');


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

	utility.update_status("Received an Instagram callback.  Now building the URL to retrieve the posts.");
	utility.update_status(instagram_update);
	instagram_update.every(function(element, index, array) {
		utility.update_status("Instagram update for " + element.object + ": " + element.object_id);
		var ig_request_url;
		config.Instagram.instagram_last_tag_id = 1;
		config.Instagram.instagram_last_geography_id =1;
		
		switch (element.object) {
		
			case "tag":
				// Download recent posts with matching tags
				g_request_url = "https://api.instagram.com/v1/tags/" + element.object_id + "/media/recent?access_token=" + config.Instagram.instagram_access_token; 
				get_Instagram_posts(config, ig_request_url, {type:"tag", value:element.object_id});	
				break;
			
			case "location":
				//Download recent posts with matching locations
				ig_request_url = "https://api.instagram.com/v1/locations/" +  element.object_id + "/media/recent?access_token=" + config.Instagram.instagram_access_token; // + "&min_id=" + tag_id;
				get_Instagram_posts(config, ig_request_url, {type:"location", value:element.object_id});							
				break;
				
			case "geography":
				// Download recent posts with matching geographies	
				ig_request_url = "https://api.instagram.com/v1/geographies/" +  element.object_id + "/media/recent?client_id=" + config.Instagram.instagram_client_id; // + "&min_id=" + tag_id;
				get_Instagram_posts(config, ig_request_url, {type:"geography", value:element.object_id});				
				break;	
				
			case "user":
				// Download recent posts with matching user
				ig_request_url = "https://api.instagram.com/v1/users/" +  element.object_id + "/media/recent?access_token=" + config.Instagram.instagram_access_token; // + "&min_tag_id=" + tag_id;
				get_Instagram_posts(config, ig_request_url, {type:"user", value:element.object_id});							
				break;
				
			default:
				// Don't know what to look for
				utility.update_status("Can't find a matching Instagram type to return");
			}	// End of switch on instagram subscription type
		
	});	// End of loop through each instagram subscription update


}



// Request Instagram media
// This can be called multiple times in case there is a problem with the connetion
var get_Instagram_posts = function(config, url, match_type, count) {

	// If count is not provided, make it zero
	// If count is more than 3, give up
	count = (typeof count === "undefined") ? 0 : count;
	if (count > 3) {return;}

	utility.update_status("Requesting Instagram update with: " + url);

	https.get(url, function(res) {
	
		var data = "";
		utility.update_status("Got Instagram response: " + res.statusCode);
		
		// Collect data as it is received from Instagram
		res.on("data", function(chunk) {
			data += chunk;
		  });
	
		// When Instagram request is done, acknowledge it
		res.on("end", function() { 
			
			if (res.statusCode ==  200) { 
				// Successfully received message from Instagram
				var ig_data = JSON.parse(data);		// Convert to JSON
				var ig_posts = ig_data.data;
				
				// Loop through all the posts, processing each one
				for (var i=ig_posts.length-1; i>=0; i=i-1) {
					process_Instagram_post(config, posts[i], match_type);			
				} 
			
			} else {
			
				// Problem with getting data from Instagram -- try again after a short wait
				console.log("Non-200 status when retrieving Instagram posts.  Trying again shortly.  Retry count is: " + count );
				setTimeout( function(){ 
						get_Instagram_posts(config, url, match_type, count+1);
					}
					,3000);			
			}
		});	
		// End of handling Instagram posts


	}).on('error', function(e) {
		utility.update_status("Got Instagram error: " + e.message);
	});	
}
	



// Take an individual Instagram post, loop through each flavor looking for a match
var process_Instagram_post = function(config, post, match_type) {

	utility.update_status("Got an Instagram post (" + post.id + ") of type " + match_type);
		
	// Loop through each flavor looking for matches
	for (var i in config.flavors) {
		
		// Loop through all the terms set up in the Google Doc looking for a match
		config.flavors[i].twitter_defs.every(function(r, index, array) {

			var output = {};
			output.content = ig_posts[i];
			output.id = ig_posts[i].id;
			output.type = "instagram";
			output.match = match_type;
			output.formatted_time = moment.unix(ig_posts[i].created_time).format("M/D/YYYY h:mm:ss A");
			output.unixtime = ig_posts[i].created_time;
	

			// Add the flavor to the message
			output.flavor = i;

			// Generate a new object ID first so that we can send it to the browser without having to do a lookup after insert
			output._id = new BSON.ObjectID();

			// Only send message to clients listening on this flavor
			utility.update_status("Instagram id " + output.id  + " sent out out to clients");	
			io.sockets.in(i).emit('instagram',output);

			// If want to use Arduino, flash lights on Arduino based on first matched attribute
			// For now, the "flash bulb" effect is hard coded into program
			if (config.flavors[i].arduino_ip) {
				var display = ( output.matches[0].displaymode == "pulse" ? 0 : 1);
				arduino.send_arduino_message(config.flavors[i].arduino_ip, output.id, "FFFFFF", "000000", 2);	
			}			

			// Save Instagram to database
			save_instagram_to_db(config, output);
		});
			
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
	//Instagram.set('callback_url', "http://swatsocial.swarthmore.edu:8000/instagram_subscription");
	Instagram.set('callback_url', "http://23.23.177.220:8008/instagram_subscription");

	console.log(Instagram.subscriptions.list());

	//Instagram.subscriptions.unsubscribe_all();

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