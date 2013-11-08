var mongo = require('mongodb'),
	moment = require('moment');


var MongoClient = mongo.MongoClient;
var BSON = mongo.BSONPure;

MongoClient.connect('mongodb://127.0.0.1:27017/swatsocial', function(err, db) {
	if(err) {console.log("Can't connect to database: " + err);}

	db.collection('posts').find({type:"tweet",matches: {$elemMatch: {matchtype:"Location"}}}).toArray(
		function(err, docs) {
			docs.forEach(function(doc) {
				console.log(doc.type);
				console.log(doc.matches);
				
				// Loop through all the matches of each tweet looking for a location match
				doc.matches.forEach(function(m) {
					if (m.matchtype == "Location") {
						var geo = m.match.split(",");
						var new_geo = geo[1] + "," + geo[0];
						m.match = new_geo;
					}
				});
				
				console.log(doc.matches)
				
				
				db.collection('posts').update({_id:doc._id}, doc,
					function(err, doc) {
						if(err) {
							console.log("Can't set new geo: " + err);
						} else {
							console.log("Updated " + doc.id);
						}
					}
				);

			});
			

    });
    
   
	
});
	//output.unixtime = moment(ig_posts[i].created_time).format("X");
	