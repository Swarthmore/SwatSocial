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

    $("#messageform").live("submit", function() {
        newMessage($(this));
        return false;
    });
    $("#messageform").live("keypress", function(e) {
        if (e.keyCode == 13) {
            newMessage($(this));
            return false;
        }
    });
    $("#message").select();
    updater.start();
});

function newMessage(form) {
    var message = form.formToDict();
    updater.socket.send(JSON.stringify(message));
    form.find("input[type=text]").val("").select();
}
 
jQuery.fn.formToDict = function() {
    var fields = this.serializeArray();
    var json = {}
    for (var i = 0; i < fields.length; i++) {
        json[fields[i].name] = fields[i].value;
    }
    if (json.next) delete json.next;
    return json;
};

var updater = {
    socket: null,

    start: function() {
        var url = "ws://" + location.host + "/chatsocket";
        if ("WebSocket" in window) {
	    updater.socket = new WebSocket(url);
        } else {
            updater.socket = new MozWebSocket(url);
        }
	updater.socket.onmessage = function(event) {
	    updater.showMessage(JSON.parse(event.data));
	}
	
	updater.socket.onopen = function(){ 
		// Set unique ID
		var id = "new_connection_" + new Date().getTime()
		var now = new Date();
		var formattedDate = dateFormat(now, 'mm/dd/yyyy hh:mm TT');
		updater.showMessage( {
				id: id,
				html: "<div class=\"message\" id=\"" + id + "\" style=\"position:relative;min-height: 150px;background-color:#eeeeee;border:3px solid #800000\"><div style=\"position:relative;margin-left:10px;font-size:75%\">Started connection to server.</div><div style=\"position:absolute;bottom:0;right:0;width:50%;font-size:50%;text-align:right\">" + formattedDate + "</div></div>"
		})
    }  	
	
	updater.socket.onclose = function(){  
		// Set unique ID
		var id = "closed_connection_" + new Date().getTime()
		var now = new Date();
		var formattedDate = dateFormat(now, 'mm/dd/yyyy hh:mm TT');
		updater.showMessage( {
				id: id,
				html: "<div class=\"message\" id=\"" + id + "\" style=\"position:relative;min-height: 150px;background-color:#eeeeee;border:3px solid #800000\"><div style=\"position:relative;margin-left:10px;font-size:75%\">Connection with server interrupted.</div><div style=\"position:absolute;bottom:0;right:0;width:50%;font-size:50%;text-align:right\">" + formattedDate + "</div></div>"
		})
    }  	
	
	
	
    },

    showMessage: function(message) {
    
    	// Don't show duplicate messages (compare id's)
        var existing = $("#m" + message.id);
        if (existing.length > 0) return;
        
        var node = $(message.html);
        node.hide();
        
        $("#inbox").prepend(node);
        node.slideDown();
    }
};
