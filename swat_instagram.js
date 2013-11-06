var arduino = require("./swat_arduino");
	https = require('https'),
	utility = require("./utility"),	
	mongo = require('mongodb');
	
var BSON = mongo.BSONPure;	


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
				// Pull down recent posts with matching tags
				find_last_instagram_tag_id(config, function(tag_id) {
					ig_request_url = "https://api.instagram.com/v1/tags/" + element.object_id + "/media/recent?access_token=" + config.Instagram.instagram_access_token; // + "&min_tag_id=" + tag_id;
					get_Instagram_posts(config, ig_request_url);	
				});
				break;
			
			case "location":
				// Pull down recent posts with matching locations
				
				find_last_instagram_tag_id(config, function(tag_id) {
					ig_request_url = "https://api.instagram.com/v1/locations/" +  element.object_id + "/media/recent?access_token=" + config.Instagram.instagram_access_token; // + "&min_id=" + tag_id;
					get_Instagram_posts(config, ig_request_url);							
				});
				break;
				
			case "geography":
				// Pull down recent posts with matching geographies	
				find_last_instagram_tag_id(config, function(tag_id) {
					ig_request_url = "https://api.instagram.com/v1/geographies/" +  element.object_id + "/media/recent?client_id=" + config.Instagram.instagram_client_id; // + "&min_id=" + tag_id;
					get_Instagram_posts(config, ig_request_url);				
				});
				break;	
				
			case "user":
				// Pull down recent posts with matching user
				find_last_instagram_tag_id(config, function(tag_id) {
					ig_request_url = "https://api.instagram.com/v1/users/" +  element.object_id + "/media/recent?access_token=" + config.Instagram.instagram_access_token; // + "&min_tag_id=" + tag_id;
					get_Instagram_posts(config, ig_request_url);							
				});
				
				break;
				
			default:
				// Don't know what to look for
				utility.update_status("Can't find a matching Instagram type to return");
				//return false;		// Jump to next element in Instagram update
			}	// End of switch on instagram subscription type
		
	});	// End of loop through each instagram subscription update


}



// Return the most recent instagram id tag
var find_last_instagram_tag_id = function(config, callback) {
	// Get last instagram post id	

	var cursor = config.db.collection('posts').find({type:"instagram"}, {id:1}).sort({id:-1}).limit(1);
	cursor.nextObject( function(err, doc) {
		utility.update_status("IG Mongo Lookup:");
		utility.update_status(typeof doc.id);
		if (typeof doc.id !== 'undefined' && doc.id) {
			callback(doc.id);
		} else {
			callback(1);
		}
	});	
}



// Request Instagram media
var get_Instagram_posts = function(config, url, count) {

	// If count is not provided, make it zero
	// If count is more than 3, give up
	count = (typeof count === "undefined") ? 0 : count;
	if (count > 3) {return;}

	utility.update_status("Requesting Instagram update with: " + url);

	https.get(url, function(res) {
	
		var data = "";
		utility.update_status("Got Instagram response: " + res.statusCode);
		
		res.on("data", function(chunk) {
			data += chunk;
		  });

		
		// When Instagram request is done, acknowledge it
		res.on("end", function() { 
			
			if (res.statusCode ==  200) {
			
				var ig_data = JSON.parse(data);		// Convert to JSON
				var ig_posts = ig_data.data;
				for (var i=ig_posts.length-1; i>=0; i=i-1) {
					var output = {};
					output.content = ig_posts[i];
					output.id = ig_posts[i].id;
					output.type = "instagram";
					output.formatted_time = moment.unix(ig_posts[i].created_time).format("M/D/YYYY h:mm:ss A");
					output.unixtime = moment(ig_posts[i].created_time).format("X");

					// Save Tweet to database and send out
					output._id = new BSON.ObjectID();
					config.db.collection('posts').insert(output, function(err, docs) {
						if (err) {
							utility.update_status("Could not save instagram post id " + output.id + " to database: " + err);
						} else {
							utility.update_status("Saved instagram post id " + output.id + " to database");
							io.sockets.emit('instagram',output);		
							utility.update_status("Instagram post id " + output.id  + " sent out out to clients");
						}
					});
				} // End of looping through posts
			
			} else {
				// Try again after a short wait
				console.log("Non-200 status when retrieving Instagram posts.  Trying again shortly.  Retry count is: " + count );
				setTimeout( function(){ 
						get_Instagram_posts(config, url, count+1);
					}
					,3000);
					
			}
		});	
		// End of handling Instagram posts



	}).on('error', function(e) {

		utility.update_status("Got Instagram error: " + e.message);
	});	
}
	




exports.instagram_handler = instagram_handler;