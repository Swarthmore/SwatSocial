var mongo = require('mongodb'),
	moment = require('moment');


var MongoClient = mongo.MongoClient;
var BSON = mongo.BSONPure;

MongoClient.connect('mongodb://127.0.0.1:27017/swatsocial', function(err, db) {
	if(err) {console.log("Can't connect to database: " + err);}

	//db.collection('posts').find({unixtime:"Invalid date"}).sort({_id:-1}).toArray(
	db.collection('posts').find().sort({_id:-1}).toArray(
		function(err, docs) {		
			docs.forEach(function(doc) {
				console.log(doc.type);
				console.log(doc.formatted_time);
				var new_unixtime = moment(doc.formatted_time).format("X");
				
				db.collection('posts').update({_id:doc._id}, {$set: {unixtime: new_unixtime}},
					function(err, db) {
						if(err) {console.log("Can't connect to database: " + err);}
					}
				);
			});
			

    });
    
   
	
});
	//output.unixtime = moment(ig_posts[i].created_time).format("X");
	
