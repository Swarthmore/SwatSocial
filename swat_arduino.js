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
	
		
		// Loop through each config sheet, pulling out the configuration information	
		for (var i in sheet_info.worksheets) {
	
			utility.update_status("Looking in " + sheet_info.worksheets[i].title  + " for Arduino information.");	

	
			// Skip the template sheet
			if ( sheet_info.worksheets[i].title != "TEMPLATE") {
			
				// Look at the Arduino IP field of the first row of the flavor worksheet to see if it present
				sheet_info.worksheets[i].getRows(0, function(err, row_data) {
				
					if (row_data[0].arduinoip) {
						utility.update_status(sheet_info.worksheets[i].title + ' has Arduino IP: ' + row_data[0].arduinoip);
						config.flavors[sheet_info.worksheets[i].title].arduino_ip = row_data[0].arduinoip;
					} else {
						utility.update_status(sheet_info.worksheets[i].title + ' does not have an Arduino IP');
						config.flavors[sheet_info.worksheets[i].title].arduino_ip = false;
					}
	
				});
			}
		}
		
		callback(err, callback);
		
		
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