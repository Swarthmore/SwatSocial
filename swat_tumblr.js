var arduino = require("./swat_arduino"),
	tumblr = require('tumblr.js'),
	utility = require("./utility"),
	mongo = require('mongodb'),
	GoogleSpreadsheet = require("google-spreadsheet");
	
var BSON = mongo.BSONPure;	





var connect_to_tumblr = function (config, callback) {
	var err;	
	config.tumblrClient = tumblr.createClient({
	  consumer_key: config.Tumblr.tumblr_consumer_key,
	  consumer_secret: config.Tumblr.tumblr_consumer_secret,
	  token: config.Tumblr.tumblr_token,
	  token_secret: config.Tumblr.tumblr_token_secret,
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

		// Add term to Tumblr tag list.  
		for (var row in row_data) {
			if (row.tumblrtags) {
				config.flavors[flavor].tumblr_tags.push(row.tumblrtags);
				utility.update_status("Found a Tumblr tag: " + row.tumblrtags);
			}
		}
	
		callback();	// For async each -- do when all done getting data from the rows
	});

		
}	
	
	









// Check to see if there is a new Tumblr post matching a tag 
var check_tumblr_tags = function(config) {

	utility.update_status("Looking for Tumblr posts");

	var tag = "todossomosayotzinapa"
	config.tumblrClient.tagged(tag, function(err, response) {

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
			});
			
			
			// Add the flavor to the message
			output.flavor = i;

			// Generate a new object ID first so that we can send it to the browser without having to do a lookup after insert
			output._id = new BSON.ObjectID();

			// Only send message to clients listening on this flavor
			utility.update_status("Tumblr id " + output.id  + " sent out out to clients");	
			io.sockets.in(i).emit('tumblr',output);

			// If want to use Arduino, flash lights on Arduino 
			// For now, the "flash bulb" effect is hard coded into program
			if (config.flavors[i].arduino_ip) {
				arduino.send_arduino_message(config.flavors[i].arduino_ip, output.id, "0000FF", "000000", 2);	
			}			

			// Save Tumblr post to database
			save_tumblr_to_db(config, output);
			
	} // End looping through the flavors

}





// Save Tumblr post to database.
var save_tumblr_to_db = function(config, output) {
	
	utility.update_status("Saving Tumblr '_id':" +  output._id);
	
	var _id = config.db.collection('posts').insert(output, function(err, object) {
		  if (err){
			  utility.update_status("Error trying to save Tumblr ID " + output.id + " to the database for flavor " + output.flavor + "\n" + err);  
		  } else {
			  utility.update_status("Saved Tumblr ID " + output.id + " to the database for flavor " + output.flavor);
		  }
	});	


} // End of save_tumblr_to_db





var start_listening_to_tumblr = function(config, callback) {
	// Check Tumblr on a set interval
	setInterval(check_tumblr_tags(config), config.Tumblr.tumblr_check_time*100);
	callback();
}




exports.connect_to_tumblr = connect_to_tumblr;
exports.load_tumblr_search_terms = load_tumblr_search_terms;
exports.check_tumblr_tags = check_tumblr_tags;
exports.start_listening_to_tumblr = start_listening_to_tumblr;
