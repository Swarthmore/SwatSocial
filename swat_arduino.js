var http = require('http'),
	utility = require("./utility"),
	GoogleSpreadsheet = require("google-spreadsheet");




// Get Arduino details for each flavor
var arduino_setup = function(config, callback) {

	utility.update_status("Connecting to Google Doc for Arduino details");
	var socialmedia_spreadsheet = new GoogleSpreadsheet(config.GoogleDoc.document_key);
	
	socialmedia_spreadsheet.getInfo( function( err, sheet_info ){

		if (err) {
			utility.update_status("Error opening Google spreadsheet: " + err);
			callback(err,config);
		}



		// Loop through each config sheet, pulling out the arduino configuration information	
		async.each(
		
			sheet_info.worksheets, 	// Collection to iterate over
			
			function(sheet, callback) {
				process_google_sheet(config, sheet.title, sheet, callback);
			}, 
			
			function(err){
							
				callback(null,config);	
   
			}	// End of async.each final function
			
		); // End of async.each
	});
}





// Given a flavor name and the corresponding spreadsheet, look for the Arduino IP and (if present) save to config 
function process_google_sheet(config, flavor, spreadsheet, callback) {

	// Don't process the template
	if (flavor == "TEMPLATE") {callback();return;}

	utility.update_status("Looking for Arduino data for \"" + spreadsheet.title + "\" flavor");
	
	spreadsheet.getRows(0, function(err, row_data){

		if (row_data && row_data.length > 0 && row_data[0].arduinoip) {
			utility.update_status(flavor + ' has Arduino IP: ' + row_data[0].arduinoip);
			config.flavors[flavor].arduino_ip = row_data[0].arduinoip;
		} else {
			utility.update_status(flavor + ' does not have an Arduino IP');
			config.flavors[flavor].arduino_ip = false;
		}
	
		callback();	// For async each -- do when all done getting data from the rows
	});

		
}	











// Send Arduino message
var send_arduino_message = function(arduino_ip, message_id, color1, color2, display_mode) {

	arduino_url = arduino_ip + "?id=" + message_id + "&color1=" + color1 + "&color2=" + color2 + "&mode=" + display_mode
	utility.update_status("Sending to Arduino: " + arduino_url);
	http.get(arduino_url, function(res) {
	  utility.update_status("Got Arduino response: " + res.statusCode);
	}).on('error', function(e) {
	  utility.update_status("Got Arduino error: " + e.message);
	});
}

exports.arduino_setup = arduino_setup; 
exports.send_arduino_message = send_arduino_message; 