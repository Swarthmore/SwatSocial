var http = require('http');

// Send Arduino message
var send_arduino_message = function(config, message_id, color1, color2, display_mode) {

	arduino_url = config.Arduino.ip_address + "?id=" + message_id + "&color1=" + color1 + "&color2=" + color2 + "&mode=" + display_mode
	console.log("Sending to Arduino: " + arduino_url);
	http.get(arduino_url, function(res) {
	  console.log("Got Arduino response: " + res.statusCode);
	}).on('error', function(e) {
	  console.log("Got Arduino error: " + e.message);
	});
}


exports.send_arduino_message = send_arduino_message; 