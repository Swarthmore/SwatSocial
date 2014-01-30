var arduino = require("./swat_arduino"),
	utility = require("./utility"),
	mongo = require('mongodb'),
	GoogleSpreadsheet = require("google-spreadsheet");
	
var BSON = mongo.BSONPure;	

var connect_to_twitter = function (config, callback) {
	var err;	
	twit = new twitter({
		consumer_key: config.Twitter.twitter_consumer_key,
		consumer_secret: config.Twitter.twitter_consumer_secret,
		access_token_key: config.Twitter.twitter_access_token,
		access_token_secret: config.Twitter.twitter_access_token_secret
	});   

	callback(err, twit);
}










var load_Twitter_search_terms = function(config, callback) {
	
	config.twitter_tracking_terms = [];
	config.twitter_follow_ids = [];
		
	utility.update_status("Connecting to Google Doc for Twitter search terms");
	var socialmedia_spreadsheet = new GoogleSpreadsheet(config.GoogleDoc.document_key);
	
	socialmedia_spreadsheet.getInfo( function( err, sheet_info ){

		if (err) {
			utility.update_status("Error opening Google spreadsheet: " + err);
			callback(err,config);
		}
	
		utility.update_status(sheet_info.title + ' is loaded' );
	
		// Loop through each config sheet, pulling out the configuration information	
		for (var sheet in sheet_info.worksheets) {
	
			// Skip the template sheet
			if ( sheet_info.worksheets[sheet].title != "TEMPLATE") {
				process_google_sheet(config, sheet_info.worksheets[sheet].title, sheet_info.worksheets[sheet])
			}
		}
	
		// Master list of Twitter search terms	
		// Loop over the flavors, pulling out the Twitter search terms and follow ids
		for (var key in config.flavors) {
			config.twitter_tracking_terms = config.twitter_tracking_terms.concat(config.flavors[key].twitter_tracking_terms);
			config.twitter_follow_ids = config.twitter_follow_ids.concat(config.flavors[key].twitter_follow_ids);
		}
	
		// Remove duplicate values
		config.twitter_tracking_terms = _und.uniq(config.twitter_tracking_terms);
		config.twitter_follow_ids = _und.uniq(config.twitter_follow_ids);

		utility.update_status("Twitter Tracking terms:\n" + config.twitter_tracking_terms);
		utility.update_status("Twitter Follow IDs:\n" + config.twitter_follow_ids);	

		callback(null,config);	
	});
}






// Given a flavor name and the corresponding spreadsheet, pull out all the data	
function process_google_sheet(config, flavor, spreadsheet) {

	utility.update_status("Processing \"" + spreadsheet.title + "\"");
	
	// Configure the flavor
	config.flavors[flavor].twitter_tracking_terms = [];
	config.flavors[flavor].twitter_follow_ids = [];
	config.flavors[flavor].twitter_defs = [];
	config.flavors[flavor].blacklist = [];
	
	spreadsheet.getRows(0, function(err, row_data){
	
		// Add term to twitter tracking list.  If the term starts with @ or #, drop it.
		for (var i in row_data) {
			getTwitterTermsFromRow(config, flavor, row_data[i])	
		}
	});
		
}	
	
	
	
	

// Given a flavor and a Google spreadsheet row, pull the Twitter terms
function getTwitterTermsFromRow(config, flavor, row) {
	
	// Twitter tracking terms
	if (row.twitterterm) {
	
		if (row.twitterterm.charAt(0)=="@" || row.twitterterm.charAt(0)=="#" ) {
			config.flavors[flavor].twitter_tracking_terms.push(row.twitterterm.substr(1));
			utility.update_status("Found a term: " + row.twitterterm.substr(1));
		} else {
			config.flavors[flavor].twitter_tracking_terms.push(row.twitterterm);
		}	
				
		// Store the entire search term to match terms, colors, and Arduino modes
		config.flavors[flavor].twitter_defs.push({
			type: "term",
			match: row.twitterterm,
			color1: row.twittercolor1,	
			color2: row.twittercolor2,
			displaymode: row.twitterdisplaymode 
			}
		);	
	}	

	
	// Twitter follow users
	if (row.twitteruserid) {
		config.flavors[flavor].twitter_follow_ids.push(row.twitteruserid);	
				
		// Store the entire search term to match terms, colors, and Arduino modes
		config.flavors[flavor].twitter_defs.push({
			type: "user",
			match: row.twitteruserid,
			color1: row.twittercolor1,	
			color2: row.twittercolor2,
			displaymode: row.twitterdisplaymode 
			}
		);			
	}	

	// Twitter blacklist
	if (row.twitterignore) {
		config.flavors[flavor].blacklist.push(row.twitterignore);
	}
	
	// Twitter geolocation
	if (["Yes", "yes", "Y", "y", "1"].indexOf(row.twittergeoenabled) > -1 ) {
		config.flavors[flavor].twitter_geo = true;
	} else {
		config.flavors[flavor].twitter_geo = false;
	}
		
}








// Begin tracking twitter search terms, users, and locations

var start_tracking_Twitter_terms = function(config, callback) {

	utility.update_status("Setting up tracking terms for Twitter.");
	console.log(config.twitter_tracking_terms.join(','));
	console.log(config.twitter_follow_ids.join(','));


	if (typeof twit.stream != undefined  && twit.stream !== null) {twit.stream.destroy;} // Destroy any existing streams
	twit.stream('statuses/filter', {
			'track':config.twitter_tracking_terms.join(','), 
			'locations':'-75.359216,39.898439,-75.350075,39.909144',
			'follow': config.twitter_follow_ids.join(',')
			},
			
		function(stream) {
		
			stream.on('error', function(error, code) {
				utility.update_status("Error setting up Twitter stream: " + error + ": " + code);
			});
		
      		stream.on('data', function(data) {tweet_handler(data, config);});
       	}
    );
    
    callback(null,config);

}








// Given a tweet, see if it matches search terms, users, or locations and (if it does) send it out to any listeners

var tweet_handler = function(tweet, config) {

		// Make sure this is a valid tweet: 
		if (typeof tweet === 'undefined' || typeof tweet.text == 'undefined' || tweet.text == null) {return;}
		utility.update_status("Got a tweet: " + tweet.text);
		
		var output = {};
		output.content = tweet;
		output.id = tweet.id;
		output.type = "tweet";
		output.formatted_time = moment(tweet.created_at).format("M/D/YYYY h:mm:ss A");
		output.unixtime = moment(tweet.created_at).format("X");
		output.matches = [];
		
		
		// Loop through each flavor looking for matches
		for (var i in config.flavors) {
		
			// If the user is on the blacklist, exit
			if (config.flavors[i].twitter_blacklist.indexOf(tweet.user.screen_name) > -1) {
				utility.update_status("Twitter user " + tweet.user.screen_name + " is blacklisted.  No further processing");
				return;
			}
		
		
			// Figure out which search term it matches
			// Loop through all the terms set up in the Google Doc looking for a match
			config.flavors[i].twitter_defs.every(function(r, index, array) {
		
				// Look for a user match
				if (r.type == "user" && tweet.user.id == r.match) {
					utility.update_status("Matched user: " + tweet.user.screen_name);
					
					var match = {
						matchtype: "User",
						match: tweet.user.screen_name,
						color1:  r.color1,
						color2:  r.color2,
						display_mode: r.displaymode
					}				
					output.matches.push(match);
				}		

				
				// See if it matched a search term (make sure there isn't an @ or # in front
				if (r.type == "term") {
					var term_location = tweet.text.toLowerCase().indexOf(r.match)
					if (term_location != -1) {
				
						// Accept if the term is the first position or it is somewhere else but not immediately preceded by @ or #
						if (term_location == 0  || ( (tweet.text.charAt(term_location-1) != "@") && (tweet.text.charAt(term_location-1) != "#"))) {
										
							utility.update_status("Matched search term: " + r.match);
				
							var match = {
								matchtype: "Term",
								match: r.match,
								color1:  r.color1,
								color2: r.color2,
								display_mode: r.displaymode
							}				
							output.matches.push(match);
						}
					}	
				} // End of checking for a term
			
			
					// See if there is a search term match in a URL
				if (r.type="term" && typeof tweet.entities.urls != 'undefined' && tweet.entities.urls !== null && _und.pluck(tweet.entities.urls, 'expanded_url').join(" ").indexOf(r.match) != -1) {
								
					utility.update_status("Matched search term " + r.match + " in URL:");
					utility.update_status(tweet.entities.urls);
						
					var url_match = _und.pluck(tweet.entities.urls, 'expanded_url').join();		
						
					var match = {
						matchtype: "URL",
						match: url_match,
						color1:  r.color1,
						color2:  r.color2,
						display_mode: r.displaymode
					}				
					output.matches.push(match);							
				}		
			
				return true;	
			}); // End of loop through Twitter search terms, users definitions, and URLs
			
			
			
			// See it if matched our location (only if geolocated is selected)
			if (config.flavors[i].twitter_geo && typeof tweet.coordinates!='undefined' && tweet.coordinates !== null && tweet.coordinates.coordinates[0] <= -75.350075 &&  tweet.coordinates.coordinates[0] >=-75.359216 &&  tweet.coordinates.coordinates[1] >= 39.898439 &&  tweet.coordinates.coordinates[1] <= 39.909144) {
		
				utility.update_status("Matched location: " + tweet.coordinates.coordinates);
					
				var match = {
					matchtype: "Location",
					match: tweet.coordinates.coordinates.reverse().join(), 	// Lat and lon are reversed in Tweeter feeds
					color1:  "FF0000",
					color2:  "A00000",
					display_mode: "party_mode"
				}				
				output.matches.push(match);
			}					
			
				

			
			// Did we find a match?  If so, send it to the listeners
			if (output.matches.length > 0) {
		
				// First replace any URLs in the text with links to the URL
				output.content.entities.urls.forEach(function(element, index, array) {
					utility.update_status("Found a URL: " + element.url);
					output.content.text = output.content.text.replace(element.url, "<a href=\"" + element.expanded_url + "\" target=\"_blank\">" + element.display_url + "</a>");
				});
			
	
				// Then replace any media links in the text 
				// Loop through all the media entities and replace text with actual link
				if (typeof output.content.entities.media != 'undefined') {
					output.content.entities.media.forEach(function(element, index, array) {
						output.content.text = output.content.text.replace(element.url, "<a href=\"" + element.expanded_url + "\" target=\"_blank\">" + element.display_url + "</a>");			
					});
				}
	
			
				// Save Tweet to database
				// Generate a new object ID first so that we can send it to the browser without having to do a lookup after insert
				output._id = new BSON.ObjectID();
				var _id = config.db.collection('posts').insert(output, function(err, docs) {
					if (err) {
						utility.update_status("Error saving tweet to database: " + err);
					} else {
						utility.update_status("Saved tweet to database");
						utility.update_status("Tweet send out");
						io.sockets.emit('tweet',output);
					
						// If want to use Arduino, flash lights on Arduino based on first matched attribute
						if (config.flavors[sheet_info.worksheets[i].title].arduino_ip) {
							var display = ( output.matches[0].displaymode == "pulse" ? 0 : 1);
							arduino.send_arduino_message(config.flavors[i].arduino_ip, output.id, output.matches[0].color1, output.matches[0].color2, display);	
						}			
					}
				});

				

						
			} else {
				utility.update_status("Did not match anything -- not displaying");
			
				if (typeof tweet.place!='undefined' && tweet.place !== null &&
					(tweet.place.name == "New Jersey" || tweet.place.name == "Pennsylvania" || tweet.place.full_name.indexOf(", PA") != -1)) {
					utility.update_status("Probably because place is PA or NJ");
				} else {
					utility.update_status(tweet);
					utility.update_status("--------------\n\n");
				}
			}
			
		}

} // End of tweet_handler








exports.connect_to_twitter = connect_to_twitter;
exports.load_Twitter_search_terms = load_Twitter_search_terms;
exports.start_tracking_Twitter_terms = start_tracking_Twitter_terms;
exports.tweet_handler = tweet_handler;
