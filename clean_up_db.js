var util = require('util'),
  	iniparser = require('iniparser'),
  	async = require('async'),
  	_und = require("underscore"),
  	moment = require('moment'),
  	mongo = require('mongodb'),
  	utility = require("./utility");

var config = {};


var MongoClient = mongo.MongoClient;
var BSON = mongo.BSONPure;

var CONFIG_FILE = './swatsocial.conf';


load_config();


function load_config() {

	config = {};	// Reset config

	async.series([
		function(callback) {
			load_config_file(CONFIG_FILE, callback);
		}, 
		
		function(callback) {
			connect_to_db(config, callback);
		},	
		
		function(callback) {
			clean_up_db(config,callback);
		}			
	],
	
	// Run this function after all the configuration is complete
	function(err, results) {
		config.configured = true;
	});
}	



function load_config_file(config_file, callback) {
	iniparser.parse(config_file, function(err,data) {
		config = data;
		utility.update_status("Opened config file");
		callback(err, config);
	});
}



function connect_to_db(config, callback) {

	utility.update_status("Connecting to database");
	MongoClient.connect("mongodb://" + config.DB.db_host + ":27017/swatsocial", function(err, db) {
		if(err) {utility.update_status("Can't connect to database: " + err);}

		config.db = db;
		callback(err, config);   
	});

}


function clean_up_db(config, callback) {

	utility.update_status("Cleaning up database");
	config.db.collection('posts').find({type:"instagram"}).sort({unixtime:-1}).toArray(
	function(err, docs) {
		docs.forEach(function(element, index, array) {
			var original_matches = element.match;
			var unique_matches = _und.uniq(element.match,function(item){return JSON.stringify(item);});
			
			if (original_matches.length != unique_matches.length) {
				config.db.collection('posts').update({_id:element._id}, {$set: {match:unique_matches}}, function(err, count) {
					if (err) {
						console.log("Could not update " +  element._id + "\n" + err);
					} else {
						console.log("Updated " + count + " records");
					}
					
				}
				
				
				);
			}
			
			
			
		});

    });
    
    callback(null, config);

}