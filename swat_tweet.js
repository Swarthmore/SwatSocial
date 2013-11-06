var arduino = require("./swat_arduino"),
	utility = require("./utility"),
	mongo = require('mongodb');
	
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
	
	utility.update_status("Connecting to Google Doc for Twitter search terms");

	var my_sheet = new GoogleSpreadsheet(config.GoogleDoc.document_key);
	my_sheet.getRows( 1, function(err, row_data){
	
	 	my_sheet.getInfo( function( err, sheet_info ){
	 		if (err) {
	 			utility.update_status(err);
	 			return;
	 		} else {
        	utility.update_status( sheet_info.title + ' is loaded' );
        	}
        });
	
		utility.update_status( 'Found '+row_data.length + ' rows in Google Doc');
		
		config.twitter_tracking_terms = [];
		config.twitter_follow_ids = [];
		config.twitter_defs = [];
		
		
		// Add term to twitter tracking list.  If the term starts with @ or #, drop it.
		row_data.forEach(function(row) {
			
			if (row.term.charAt(0)=="@" || row.term.charAt(0)=="#" ) {
				config.twitter_tracking_terms.push(row.term.substr(1));
			} else {
				config.twitter_tracking_terms.push(row.term);
			}	
			
			// Look for Twitter user ID's to follow (not google-spreadsheet drops non-alphanumeric characters in column names)
			if (row.userid) {
				config.twitter_follow_ids.push(row.userid);	
			}	
			
			// Store the entire search term row (up through the first 5 rows) to match terms, colors, and Arduino modes
			config.twitter_defs.push(row);	
			
		});
				
		utility.update_status("Twitter Tracking terms:\n" + config.twitter_tracking_terms);
		utility.update_status("Twitter Follow IDs:\n" + config.twitter_follow_ids);
	
		callback(null,config);
		
	})
	
}











// Begin tracking twitter search terms, users, and locations

var start_tracking_Twitter_terms = function(config, callback) {



	utility.update_status("Setting up tracking terms for Twitter.");

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
		output.unixtime = moment.unix(tweet.created_at) + 0;
		output.matches = [];
		
		
		// Figure out which search term it matches
		// Loop through all the terms set up in the Google Doc looking for a match
		config.twitter_defs.every(function(r, index, array) {
		
			// Remove @ and # from start of search term
			//var term = (r.term.charAt(0)=="@" || r.term.charAt(0)=="#" ? r.term.substr(1) : r.term)
			
			// Look for a user match
			if (tweet.user.id == r.userid) {
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

				
			// See if it matched a search term	
			if (tweet.text.toLowerCase().indexOf(r.term) != -1) {
						
				utility.update_status("Matched search term: " + r.term);
				
				var match = {
					matchtype: "Term",
					match: r.term,
					color1:  r.color1,
					color2: r.color2,
					display_mode: r.displaymode
				}				
				output.matches.push(match);
			}	
			
			
				// See if there is a search term match in a URL
			if (typeof tweet.entities.urls != 'undefined' && tweet.entities.urls !== null && _und.pluck(tweet.entities.urls, 'expanded_url').join(" ").indexOf(r.term) != -1) {
								
				utility.update_status("Matched search term " + r.term + " in URL:");
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
			
		// See it if matched our location
		if (typeof tweet.coordinates!='undefined' && tweet.coordinates !== null && tweet.coordinates.coordinates[0] <= -75.350075 &&  tweet.coordinates.coordinates[0] >=-75.359216 &&  tweet.coordinates.coordinates[1] >= 39.898439 &&  tweet.coordinates.coordinates[1] <= 39.909144) {
		
			utility.update_status("Matched location: " + tweet.coordinates.coordinates);
		
			var match = {
				matchtype: "Location",
				match: tweet.coordinates.coordinates.join(),
				color1:  "FF0000",
				color2:  "A00000",
				display_mode: "party_mode"
			}				
			output.matches.push(match);
		}					
			
				

			
		// Did we find a match?  If so, send it to the listeners
		if (output.matches.length > 0) {
		
			// First replace any URLs in the text with links to the URL
			output.content.entities.urls.every(function(element, index, array) {
				utility.update_status("Found a URL: " + element.url);
				output.content.text = output.content.text.replace(element.url, "<a href=\"" + element.url + "\" target=\"_blank\">" + element.url + "</a>");
			});
			
	
	
			
			// Save Tweet to database
			// Generate a new object ID first so that we can send it to the browser without having to do a lookup after insert
			output._id = new BSON.ObjectID();
			var _id = config.db.collection('posts').insert(output, function(err, docs) {
				if (err) {
					utility.update_status("Error saving tweet to database: " + err);
				} else {
					utility.update_status("Saved tweet to database");
				}
			});

			utility.update_status("Tweet send out");
			io.sockets.emit('tweet',output);	

			// Flash lights on Arduino based on first matched attribute
			var display = ( output.matches[0].displaymode == "pulse" ? 0 : 1);
			arduino.send_arduino_message(config, output.id, output.matches[0].color1, output.matches[0].color2, display);
						
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

} // End of tweet_handler








exports.connect_to_twitter = connect_to_twitter;
exports.load_Twitter_search_terms = load_Twitter_search_terms;
exports.start_tracking_Twitter_terms = start_tracking_Twitter_terms;
exports.tweet_handler = tweet_handler;
