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
		async.each(
		
			sheet_info.worksheets, 	// Collection to iterate over
			
			function(sheet, callback) {
				process_google_sheet(config, sheet.title, sheet, callback);
			}, 
			
			function(err){
							
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
   
			}	// End of async.each final function
			
		); // End of async.each
		
	}); // end of socialmedia_spreadsheet.getInfo
	
} // end of load_Twitter_search_terms






// Given a flavor name and the corresponding spreadsheet, pull out all the data	
function process_google_sheet(config, flavor, spreadsheet, callback) {

	// Don't process the template
	if (flavor == "TEMPLATE") {callback();return;}

	utility.update_status("Processing \"" + spreadsheet.title + "\"");

	// Configure the flavor
	config.flavors[flavor].twitter_tracking_terms = [];
	config.flavors[flavor].twitter_follow_ids = [];
	config.flavors[flavor].twitter_defs = [];
	config.flavors[flavor].twitter_blacklist = [];

	spreadsheet.getRows(0, function(err, row_data){

		// Twitter geolocation
		if (row_data && row_data.length > 0 && ["Yes", "yes", "Y", "y", "1"].indexOf(row_data[0].twittergeoenabled) > -1 ) {
			config.flavors[flavor].twitter_geo = true;
		} else {
			config.flavors[flavor].twitter_geo = false;
		}


		// Add term to twitter tracking list.  If the term starts with @ or #, drop it.
		for (var i in row_data) {
			getTwitterTermsFromRow(config, flavor, row_data[i])	
		}
	
		callback();	// For async each -- do when all done getting data from the rows
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
			match_type: "term",
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
			match_type: "user",
			match: row.twitteruserid,
			color1: row.twittercolor1,	
			color2: row.twittercolor2,
			displaymode: row.twitterdisplaymode 
			}
		);			
	}	

	// Twitter blacklist
	if (row.twitterignore) {
		config.flavors[flavor].twitter_blacklist.push(row.twitterignore);
	}
	

		
}








// Begin tracking twitter search terms, users, and locations

var start_tracking_Twitter_terms = function(config, callback) {

	utility.update_status("Setting up tracking terms for Twitter.");
	console.log(config.twitter_tracking_terms.join(','));
	console.log(config.twitter_follow_ids.join(','));
	console.log(config.flavors);

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
		
		// Generate a new object ID first so that we can send it to the browser without having to do a lookup after insert
		// It is common across all the flavors, so we can update the flavor list of the post in MongoDB
		// without having to have duplicate Tweets
		var mongo_id = new BSON.ObjectID();
		
		
		// Loop through each flavor looking for matches
		for (var i in config.flavors) {
		
			var output = {};
			output._id = mongo_id;		// This is common across all the flavors
			output.content = tweet;
			output.id = tweet.id;
			output.type = "tweet";
			output.formatted_time = moment(tweet.created_at).format("M/D/YYYY h:mm:ss A");
			output.unixtime = moment(tweet.created_at).format("X");
			output.matches = [];
		
			utility.update_status("Checking the tweet for: " + i + " flavor");
		
			// If the user is on the blacklist, exit
			if (config.flavors[i].twitter_blacklist.indexOf(tweet.user.screen_name) > -1) {
				utility.update_status("Twitter user " + tweet.user.screen_name + " is blacklisted.  No further processing");
				return;
			}
		
		
			// Figure out which search term it matches
			// Loop through all the terms set up in the Google Doc looking for a match
			config.flavors[i].twitter_defs.every(function(r, index, array) {
		
				// Look for a user match
				if (r.match_type == "user" && tweet.user.id == r.match) {
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
				if (r.match_type == "term") {
				
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
				if (r["type"]="term" && typeof tweet.entities.urls != 'undefined' && tweet.entities.urls !== null && _und.pluck(tweet.entities.urls, 'expanded_url').join(" ").indexOf(r.match) != -1) {
								
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
	
			


				
				utility.update_status("Tweet send out");		
				// Only send message to clients listening on this flavor
				io.sockets.in(i).emit('tweet',output);
	
				// If want to use Arduino, flash lights on Arduino based on first matched attribute
				if (config.flavors[i].arduino_ip) {
					var display = ( output.matches[0].displaymode == "pulse" ? 0 : 1);
					arduino.send_arduino_message(config.flavors[i].arduino_ip, output.id, output.matches[0].color1, output.matches[0].color2, display);	
				}			
			
				// Save Tweet to database
				save_tweet(config, output, i);
						
			} else {
			
				// Tweet did not match any terms, users, URL, locations, etc.  Don't send out or save.
				
				utility.update_status("Did not match anything -- not displaying");
			
				// Print out a note if this is probably due to location
				if (typeof tweet.place!='undefined' && tweet.place !== null &&
					(tweet.place.name == "New Jersey" || tweet.place.name == "Pennsylvania" || tweet.place.full_name.indexOf(", PA") != -1)) {
					utility.update_status("Probably because place is PA or NJ");
				} 
			}
			
		} // End of looping through the flavors

} // End of tweet_handler






// Save Tweet to database.
// Only one Tweet is saved in the database no matter how many flavors match.
// If this is the first time a Tweet is being saved, save it with a flavors array of a single flavor element
// If another flavor matches this Tweet, add the new flavor to the existing document
var save_tweet = function(config, output, flavor) {

	// Save Tweet to database		
	// First check to see if Mongo _id exists already.  If not, save the Tweet. If so, add this flavor to the
	// flavor list
	
	utility.update_status("Saving Tweet '_id':" +  output._id);
	
	config.db.collection('posts').find({_id: output._id}).toArray(function(err, results) {
		
		if (err) { 
			utility.update_status("Error checking existing Tweets in the database: " + err);
			
		} else { 

			console.log("Results of find ");
			console.log(results);

			if (results.length > 0) {
				// Found a matching _id in the database.  Update, by adding the current flavor to the flavor list
				console.log("Found a matching id in the database, add current flavor to Tweet id " + output._id);
				
				var _id = config.db.collection('posts').update({'_id': output._id}, { $push: { 'flavors': flavor }}, function(err, object) {
					  if (err){
						  utility.update_status("Error trying to update flavors for Tweet ID " + output.id + "\n" + err);  
					  } else {
						  utility.update_status("Updated flavors for Tweet ID " + output.id);
					  }
				});
			
			} else {
			
				// This Tweet hasn't yet been saved to the database.  Save it with the initial flavor listing
				console.log("No matching id in the database, save a new entry for " + flavor + " flavor to Tweet id " + output._id);
				output.flavors = [flavor];
				var _id = config.db.collection('posts').insert(output, function(err, object) {
					  if (err){
						  utility.update_status("Error trying to save Tweet ID " + output.id + " to the database for flavor " + flavor + "\n" + err);  
					  } else {
						  utility.update_status("Saved Tweet ID " + output.id + " to the database for flavor " + flavor);
					  }
				});	

			} 
		} // End of saving Tweets to the database
		
	}); // End of Tweet database operations


} // End of save_tweet







exports.connect_to_twitter = connect_to_twitter;
exports.load_Twitter_search_terms = load_Twitter_search_terms;
exports.start_tracking_Twitter_terms = start_tracking_Twitter_terms;
exports.tweet_handler = tweet_handler;
