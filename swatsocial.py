#!/usr/bin/env python

# Program to capture social media, display it, and integrate with an Arduino.

import logging
import tornado.escape
import tornado.ioloop
import tornado.options
import tornado.web
import tornado.websocket
import os.path
import uuid
from twython import TwythonStreamer
import requests 

from itertools import islice 
import re
import ConfigParser
import datetime
import time
import json
from tornado.options import define, options
from tornado.template import Template, Loader
#from instagram.client import InstagramAPI
import os


# Built-in modules
from utility import *
import twitter
from chatSocket import *
import arduino
import db



# Load config 
Config = ConfigParser.ConfigParser()
Config.read("swatsocial.conf")



### Tornado Configuration ###
define("port", default=Config.get('app', "port"), help="run on the given port", type=int)
set_debug_mode(Config.get('app', "debug_mode"))
 
 
### Arduino Configuration ###
arduino.set_arduino_ip(Config.get('Arduino', "ip_address"))


### Twitter Configuration ###
twitter_def_url = Config.get('Twitter', "twitter_definition_url")

twitter_configuration = {
	"twitter_consumer_secret": Config.get('Twitter', "twitter_consumer_secret"),
	"twitter_consumer_key": Config.get('Twitter', "twitter_consumer_key"),
	"twitter_access_token_secret": Config.get('Twitter', "twitter_access_token_secret"),
	"twitter_access_token": Config.get('Twitter', "twitter_access_token")	
}


twitter_definition_refresh = Config.getint('Twitter', "twitter_definition_refresh")



### Instagram Configuration ###
instagram_last_location_id = 0
instagram_last_tag_id = "0"
instagram_last_geography_id = "0"
instagram_check_time = Config.getint('Instagram', "instagram_check_time")
instagram_client_secret = Config.get('Instagram', "instagram_client_secret")
instagram_access_token = Config.get('Instagram', "instagram_access_token")
instagram_client_id = Config.get('Instagram', "instagram_client_id")



### Tumblr Configuration ###
tumblr_api_url = Config.get('Tumblr', "tumblr_api_url")	
tumblr_api_key = Config.get('Tumblr', "tumblr_api_key")	
tumblr_check_time = Config.getint('Tumblr', "tumblr_check_time")
tumblr_last_id = 0



### Database Configuration ###
db.connect(Config.get('DB', "db_host"), Config.get('DB', "db_name"))





### Set time zone ###
os.environ['TZ'] = 'America/New_York'
time.tzset()

"""
# Get latest instagram posts from the database
print "----- Looking for recent Instagram geography posts"
cursor = db.db.instagram.find({"created_time":{"$gte": datetime.datetime(2013, 3, 23)}}).sort("id",-1)

ig_posts = []
for document in cursor:
	print document["id"]
	ig_posts.append(document)
	if document["id"] > instagram_last_tag_id:
		instagram_last_tag_id = document["id"]
		instagram_last_location_id = document["id"]
cursor = db.db.posts.find(limit=10).sort("_id",-1)
print "----- End of recent instagram posts"
"""



class Application(tornado.web.Application):

	def __init__(self):
		handlers = [
			(r"/", MainHandler),
			(r"/chatsocket", ChatSocketHandler),
			(r"/instagram_subscription", Instagram_Sub),
		]
		
		settings = dict(
			template_path=os.path.join(os.path.dirname(__file__), "templates"),
			static_path=os.path.join(os.path.dirname(__file__), "static"),
			debug=True, 
			db=db          
		)
        
		tornado.web.Application.__init__(self, handlers, **settings)



# Retrieve insteresting posts from Tumblr
def check_tumblr():

	global tumblr_api_key
	global tumblr_api_url
	global tumblr_last_id

	# Request tagged posts from Tumblr
	update_status("Searching for Tumblr posts.  Last id is %s" % tumblr_last_id, 1)
	payload = {'tag': 'Swarthmore', 'api_key': tumblr_api_key}
	r = requests.get(tumblr_api_url, params=payload)
  
	posts = r.json()	
	for post in posts["response"]:
		if  post["id"] > tumblr_last_id:
		
			# Send out post to clients
			update_status("Found a new Tumblr post from %s" % post["blog_name"], 1)
			
			# Save the Tumblr post
			# Async insert; callback is executed when insert completes
   			#db.tumblr.insert({'post': post}, callback=saved_tumblr)
			
			loader = Loader("./templates")
			post["timestamp"] = datetime.datetime.fromtimestamp(int(post["timestamp"])).strftime("%m/%d/%Y %H:%M:%S")
			post["html"] = loader.load("tumblr_message.html").generate(message=post)	
		
		
			# Send the Tumblr info to all the clients
			for waiter in ChatSocketHandler.waiters:
				try:
					waiter.write_message(post)	
				except:
					logging.error("Error sending Tumblr message", exc_info=True)	
					
			# Insert Tumblr post to database	
			db.save({'type':'tumblr','data':post})		

	# Record the highest post id
	for post in posts["response"]:
		if post["id"] > tumblr_last_id:
			tumblr_last_id = post["id"]





class MainHandler(tornado.web.RequestHandler):
	def get(self):
		print "Someone asked for home page"
		self.render("index.html", messages=ChatSocketHandler.cache)
		

			


class Instagram_Sub(tornado.web.RequestHandler):

	
	def get(self):
		challenge = self.get_argument("hub.challenge","")
		if len(challenge) > 0:
			self.render("instagram_subscription_verification.html", challenge=challenge)
		
	def post(self):
	
		global instagram_last_tag_id
		global instagram_last_geography_id
	
		# Figure out what is posted from Instagram
		x_hub_signature = self.get_argument('X-Hub-Signature', "")
	 	
		ig_updates = json.loads(self.request.body)
	 	
		# Need to respond within 2 seconds
		self.write("Got it")
		
		for update in ig_updates:
		
			ig_request_url = ""
			
			if update["object"] == "tag":
				# Pull down recent posts with matching tags
				ig_request_url = "https://api.instagram.com/v1/tags/" + update["object_id"] + "/media/recent?access_token=" + instagram_access_token + "&min_tag_id=" + instagram_last_tag_id
			
			elif update["object"] == "location":
				# Pull down recent posts with matching locations
				ig_request_url = "https://api.instagram.com/v1/locations/" + update["object_id"] + "/media/recent?access_token=" + instagram_access_token + "&min_id=" + instagram_last_tag_id
				
			elif update["object"] == "geography":
				# Pull down recent posts with matching geographies
				ig_request_url = "https://api.instagram.com/v1/geographies/" + update["object_id"] + "/media/recent?client_id=" + instagram_client_id + "&min_id=" + instagram_last_geography_id	
				
			elif update["object"] == "user":
				# Pull down recent posts with matching user
				ig_request_url = "https://api.instagram.com/v1/users/" + update["object_id"] + "/media/recent?access_token=" + instagram_access_token + "&min_tag_id=" + instagram_last_tag_id
				
			else:
				# Don't know what to look for
				update_status("Can't find a matching Instagram type to return", 1)
				return
				
				
			print 
			print update
			print ig_request_url
			
			r = requests.get(ig_request_url , timeout=5)
			
			print "***************"
			print "Instgram text:" + r.text
			print "***************"
			
	 		r_json = json.loads(r.text)
			
			# If min_tag_id was send, check to see if it later than the current last id
			# Note - geography and tag/location/user ids are different.
			if r_json.get("pagination"):
				if r_json["pagination"].get("min_tag_id"):
					if r_json["pagination"]["min_tag_id"] > instagram_last_tag_id:
						instagram_last_tag_id = r_json["pagination"]["min_tag_id"]
					print " --> Last tag id " + instagram_last_tag_id
						
				elif (update["object"] == "geography") and (r_json["pagination"].get("next_min_id")):
					# Geography 
					if r_json["pagination"]["next_min_id"] > instagram_last_geography_id:
						instagram_last_geography_id = r_json["pagination"]["next_min_id"]
					print " --> Last geography id " + instagram_last_geography_id

			

			ig_posts = r_json["data"]
			for post in ig_posts:
			
				post["post_id"] = post["id"]
				del post["id"]
			
				if not post.get("tags"):
					post["tags"] = [""]
			
				print post["post_id"] + " " + post["tags"][0] + " " + post["created_time"]
			
				update_status("Found a new Instragram post by %s" % post["user"]["username"], 1)

				# Set time to human readable and type to the database
				post["time"] = time.strftime("%D %H:%M", time.localtime(int(post["created_time"])))
				post["swatsocial_type"] = "Instagram"
				
				
				# Save the Instagram post
				# Async insert; callback is executed when insert completes
				#print media.id, media.created_time, media.caption.text, media.user.username, media.filter
				db.inert(post)
				
				# Send media to template and post it
				loader = Loader("./templates")
				msg = {}
				msg["html"] = loader.load("instagram_message.html").generate(message=post)

				# Send the Instagram info to all the clients
				for waiter in ChatSocketHandler.waiters:
					try:
						waiter.write_message(msg)	
					except:
						logging.error("Error sending Instrgram message", exc_info=True)
			
				# Send Arduino message
				arduino.send_arduino_message(str(post["post_id"]), "FFFFFF", "000000", 2)
					
				# Insert Instagram post to database	
				db.insert({'type':'instagram','data':post})	       








def process_instagram_tag_update(update):
	print "Got an instragram update: " + update



# Set things up
def main():

	# Set up Twitter stream
	twitter.setup_twitter_stream(twitter_def_url, twitter_configuration)
	
	
	# Set up Twitter search term refresh (convert hours to milliseconds)
	twitter_def_callback = tornado.ioloop.PeriodicCallback(twitter.getTwitterSearchTerms, twitter_definition_refresh*60*60*1000)
	twitter_def_callback.start()

	# Set up Instagram periodic call backs	(convert seconds to milliseconds)
	#instagram_api.create_subscription(object='tag', object_id='bacon', aspect='media', callback_url='http://54.235.105.98:8008/instagram_subscription')
	
	# Set up Tumblr periodic call backs	(convert seconds to milliseconds)
	#tumblr_callback = tornado.ioloop.PeriodicCallback(check_tumblr, tumblr_check_time*1000)
	#tumblr_callback.start()




	# Set up Tornado to send data to clients
	tornado.options.parse_command_line()
	app = Application()
	app.listen(options.port)
	
	io_loop = tornado.ioloop.IOLoop.instance().start()
 



if __name__ == "__main__":
    main()


