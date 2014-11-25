var arduino = require("./swat_arduino"),
	tumblr = require('tumblr.js'),
	utility = require("./utility"),
	mongo = require('mongodb'),
	GoogleSpreadsheet = require("google-spreadsheet");
	
var BSON = mongo.BSONPure;	





var connect_to_tumblr = function (config, callback) {
	var err;	
	tumblr = = tumblr.createClient({
	  consumer_key: config.tumblr.tumblr_consumer_key,
	  consumer_secret: config.tumblr.tumblr_consumer_secret,
	  token: config.tumblr.tumblr_token,
	  token_secret: config.tumblr.tumblr_token_secret,
	});

	callback(err, tumblr);
}






var load_tumblr_search_terms = function(config, callback) {
	
	config.tumblr_tags = [];
		
	utility.update_status("Connecting to Google Doc for Tumblr search terms");
	var socialmedia_spreadsheet = new GoogleSpreadsheet(config.GoogleDoc.document_key);
	
	socialmedia_spreadsheet.getInfo( function( err, sheet_info ) {

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
							
				// Master list of Tumblr tags
				// Loop over the flavors, pulling out the Twitter search terms and follow ids
				for (var key in config.flavors) {
					config.tumblr_tags = config.tumblr_tags.concat(config.flavors[key].tumblr_tags);
				}
	
				// Remove duplicate values
				config.tumblr_tags = _und.uniq(config.tumblr_tags);

				utility.update_status("Tumblr tags:\n" + config.tumblr_tags);

				callback(null,config);	
   
			}	// End of async.each final function
		); // End of async.each
	}); // end of socialmedia_spreadsheet.getInfo
} // end of load_tumblr_search_terms






// Given a flavor name and the corresponding spreadsheet, pull out all the data	
function process_google_sheet(config, flavor, spreadsheet, callback) {

	// Don't process the template
	if (flavor == "TEMPLATE") {callback();return;}

	utility.update_status("Processing \"" + spreadsheet.title + "\"");

	// Configure the flavor
	config.flavors[flavor].tumblr_tags = [];

	spreadsheet.getRows(0, function(err, row_data){

		// Add term to Tumblr tag list.  If the term starts with @ or #, drop it.
		for (var i in row_data) {
			if (row.tumblrtags) {
				config.flavors[flavor].tumblr_tags.push(row.tumblrtags);
				utility.update_status("Found a Tumblr tag: " + row.tumblrtags);
			}
		}
	
		callback();	// For async each -- do when all done getting data from the rows
	});

		
}	
	
	









// Check to see if there is a new Tumblr post matching a tag 
var check_tumblr_tags = function(config, callback) {

	utility.update_status("Looking for Tumblr posts");

	var tag = "todossomosayotzinapa"
	client.tagged(tag, function(err, response) {

		if (err) {
			utility.update_status("Could not search Tumblr term: " + tag + ": " + err);
			return;
		} else {
			utility.update_status(response);
	
			var posts = response;
			posts.forEach( function(post, index, array) {
				tumblr_handler(post, config);
			});
			
		}

	}); // End of Tumblr tag lookup

}








// Given a Tumblr post, see if it matches tags for each flavor send it out to any listeners

var tumblr_handler = function(post, config) {

		// Make sure this is a valid Tumblr post: 
		if (typeof post === 'undefined' || typeof post.blog_name === 'undefined') {return;}
		utility.update_status("Got a Tumblr post from " + post.blog_name);
		
		// Loop through each flavor looking for matches
		for (var i in config.flavors) {
		
			var output = {};
			output.content = post;
			output.id = post.id;
			output.type = "tumblr";
			output.formatted_time = moment(post.date).format("M/D/YYYY h:mm:ss A");
			output.unixtime = post.timestamp;
			output.matches = [];
		
			utility.update_status("Checking the Tumblr post for: " + i + " flavor");
		
			// Figure out which tag it matches
			// Loop through all the tags set up in the Google Doc looking for a match
			config.flavors[i].tumblr_tags.every(function(tag, index, array) {
				
				// See if it matched a tag
				var tag_index = post.tags.indexOf(tag)
				if (tag_index != -1) {
					utility.update_status("Found Tumblr tag: " + tag);
					output.matches.push(tag);
				} // End of checking for a tag
			
			
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
	
				
				// Add the flavor to the message
				output.flavor = i;
				
				// Generate a new object ID first so that we can send it to the browser without having to do a lookup after insert
				output._id = new BSON.ObjectID();

				// Only send message to clients listening on this flavor
				utility.update_status("Tweet send out");	
				io.sockets.in(i).emit('tweet',output);
	
				// If want to use Arduino, flash lights on Arduino based on first matched attribute
				if (config.flavors[i].arduino_ip) {
					var display = ( output.matches[0].displaymode == "pulse" ? 0 : 1);
					arduino.send_arduino_message(config.flavors[i].arduino_ip, output.id, output.matches[0].color1, output.matches[0].color2, display);	
				}			
			
				// Save Tweet to database
				save_tweet(config, output);
						
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
var save_tweet = function(config, output) {
	
	utility.update_status("Saving Tweet '_id':" +  output._id);
	
	var _id = config.db.collection('posts').insert(output, function(err, object) {
		  if (err){
			  utility.update_status("Error trying to save Tweet ID " + output.id + " to the database for flavor " + output.flavor + "\n" + err);  
		  } else {
			  utility.update_status("Saved Tweet ID " + output.id + " to the database for flavor " + output.flavor);
		  }
	});	


} // End of save_tweet







exports.connect_to_twitter = connect_to_twitter;
exports.load_Twitter_search_terms = load_Twitter_search_terms;
exports.start_tracking_Twitter_terms = start_tracking_Twitter_terms;
exports.tweet_handler = tweet_handler;
