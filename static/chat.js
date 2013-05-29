// Copyright 2009 FriendFeed
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may
// not use this file except in compliance with the License. You may obtain
// a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations
// under the License.

$(document).ready(function() {
    if (!window.console) window.console = {};
    if (!window.console.log) window.console.log = function() {};

    start_ws();
});


var socket;
var socketTimer;
var ws_heartbeat_interval = 60000;		// Websocket heartbeat (to keep connection open)

function start_ws() {
	// Define websocket URL
	var url = "ws://" + location.host + "/chatsocket";
	
	// Create websocket (with FireFox compatbility check)
	if ("WebSocket" in window) {
		socket = new WebSocket(url);
	} else {
		socket = new MozWebSocket(url);
	}
	
	// On new message, display it
	socket.onmessage = function(event) {
		showMessage(JSON.parse(event.data));
	};
	
	// When socket is opened, display notification message
	socket.onopen = function(){ 
		// Set unique ID
		var id = "new_connection_" + new Date().getTime()
		var now = new Date();
		var formattedDate = dateFormat(now, 'mm/dd/yyyy hh:MM TT');
		
		showMessage( {
			id: id,
			html: "<div class=\"message\" id=\"" + id + "\" style=\"position:relative;min-height: 50px;background-color:#eeeeee;border:3px solid #800000\"><div style=\"position:relative;margin-left:10px;font-size:75%\">Started connection to server.</div><div style=\"position:absolute;bottom:0;right:0;width:50%;font-size:50%;text-align:right\">" + formattedDate + "</div></div>"
		})
		
		// Turn off automatic attempts to start socket
		clearInterval(socketTimer);
		
		// Replace with heartbeat 
		socketTimer = setInterval(function() {socket.send('heartbeat');}, ws_heartbeat_interval);
		
		
    }; 	
	
	// If socket is closed, display notification message
	socket.onclose = function(){  
		// Set unique ID
		var id = "connection_closed_" + new Date().getTime()
		var now = new Date();
		var formattedDate = dateFormat(now, 'mm/dd/yyyy hh:mm TT');
		showMessage( {
			id: id,
			html: "<div class=\"message\" id=\"" + id + "\" style=\"position:relative;min-height: 50px;background-color:#eeeeee;border:3px solid #800000\"><div style=\"position:relative;margin-left:10px;font-size:75%\">Connection with server interrupted.</div><div style=\"position:absolute;bottom:0;right:0;width:50%;font-size:50%;text-align:right\">" + formattedDate + "</div></div>"
		})
		
		// Turn off automatic attempts to send heartbeat
		clearInterval(socketTimer);		
		
		// Keep trying to restart connection
		socketTimer = setInterval(function(){start_ws()}, 5000);
		
    } ; 	
	
	// If there is a socket error, display a notification message
	socket.onerror = function(){  
		// Set unique ID
		var id = "connection_error_" + new Date().getTime()
		var now = new Date();
		var formattedDate = dateFormat(now, 'mm/dd/yyyy hh:mm TT');
		showMessage( {
			id: id,
			html: "<div class=\"message\" id=\"" + id + "\" style=\"position:relative;min-height: 50px;background-color:#eeeeee;border:3px solid #800000\"><div style=\"position:relative;margin-left:10px;font-size:75%\">Websocket error.</div><div style=\"position:absolute;bottom:0;right:0;width:50%;font-size:50%;text-align:right\">" + formattedDate + "</div></div>"
		})
    }; 
};
	

	
function showMessage(message) {
    
	// Don't show duplicate messages (compare id's)
	var existing = $("#m" + message.id);
	if (existing.length > 0) return;

	var node = $(message.html);
	node.hide();

	$("#inbox").prepend(node);
	node.slideDown();
}
