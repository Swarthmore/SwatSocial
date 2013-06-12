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
import tweetstream
import requests 
import StringIO
import csv
from itertools import islice 
import re
import ConfigParser
import datetime
import time
import json
from tornado.options import define, options
from tornado.template import Template, Loader
#from instagram.client import InstagramAPI
from pymongo import MongoClient
import os

# Load config 
Config = ConfigParser.ConfigParser()
Config.read("swatsocial.conf")



### Tornado Configuration ###
define("port", default=Config.get('app', "port"), help="run on the given port", type=int)
debug_mode = Config.get('app', "debug_mode")

 
 
### Arduino Configuration ###
arduino_ip = Config.get('Arduino', "ip_address")



### Twitter Configuration ###
twitter_def_url = Config.get('Twitter', "twitter_definition_url")

twitter_configuration = {
	"twitter_consumer_secret": Config.get('Twitter', "twitter_consumer_secret"),
	"twitter_consumer_key": Config.get('Twitter', "twitter_consumer_key"),
	"twitter_access_token_secret": Config.get('Twitter', "twitter_access_token_secret"),
	"twitter_access_token": Config.get('Twitter', "twitter_access_token")	
}

twitter_tracking_terms = ""
twitter_follows = ""
twitter_search_terms = {}
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
client = MongoClient(Config.get('DB', "db_host"), 27017)
db = client[Config.get('DB', "db_name")]



### Set time zone ###
os.environ['TZ'] = 'America/New_York'
time.tzset()


# Get latest Tweets posts from the database
print "----- Looking for recent Tweets"
cursor = db.tweets.find({"created_time":{"$gte": datetime.datetime(2013, 3, 23)}}).sort("id",-1)

ig_posts = []
for document in cursor:
	print document["id"]
	ig_posts.append(document)
	if document["id"] > instagram_last_tag_id:
		instagram_last_tag_id = document["id"]
		instagram_last_location_id = document["id"]

print "----- End of recent tweets"


# Get latest instagram posts from the database
print "----- Looking for recent Instagram geography posts"
cursor = db.instagram.find({"created_time":{"$gte": datetime.datetime(2013, 3, 23)}}).sort("id",-1)

ig_posts = []
for document in cursor:
	print document["id"]
	ig_posts.append(document)
	if document["id"] > instagram_last_tag_id:
		instagram_last_tag_id = document["id"]
		instagram_last_location_id = document["id"]

print "----- End of recent instagram posts"




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
			db.posts.insert({'type':'tumblr','data':post})		

	# Record the highest post id
	for post in posts["response"]:
		if post["id"] > tumblr_last_id:
			tumblr_last_id = post["id"]





class MainHandler(tornado.web.RequestHandler):
	def get(self):
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
				db.instagram.save(post)
				
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
				arduino_url = arduino_ip + "?id=" + str(post["post_id"]) + "&color1=FFFFFF&color2=000000&mode=2"
				try:
					print "Sending to Arduino: " + arduino_url
					r = requests.get(arduino_url, timeout=4)
		
				except requests.exceptions.Timeout:
					print "Arduino request timed out" 
				
				except:
					print "Cannot connect to Arduino"     
					
				# Insert Instagram post to database	
				db.posts.insert({'type':'instagram','data':post})	       




class ChatSocketHandler(tornado.websocket.WebSocketHandler):
    waiters = set()
    cache = []
    cache_size = 200

    def allow_draft76(self):
        # for iOS 5.0 Safari
        return True

    def open(self):
        ChatSocketHandler.waiters.add(self)

    def on_close(self):
        ChatSocketHandler.waiters.remove(self)

    @classmethod
    def update_cache(cls, chat):
        cls.cache.append(chat)
        if len(cls.cache) > cls.cache_size:
            cls.cache = cls.cache[-cls.cache_size:]

    @classmethod
    def send_updates(cls, chat):
        logging.info("sending message to %d waiters", len(cls.waiters))
        for waiter in cls.waiters:
            try:
                waiter.write_message(chat)
            except:
                logging.error("Error sending message", exc_info=True)


    def on_message(self, message):
		logging.info("got message '%r'", message)
		if message.startswith("heartbeat"):
			print "Received heartbeat"
		
		elif message.startswith("get_history"):
			cursor = db.posts.find(limit=10).sort("_id",-1)
			for document in cursor:
				loader = Loader("./templates")
		
				msg = {}
				if document["type"] == "instagram":
					msg["html"] = loader.load("instagram_message.html").generate(message=document["data"])
				elif document["type"] == "tweet":
					msg["html"] = loader.load("tweet_message.html").generate(message=document["data"])
				elif document["type"] == "tumblr":
					msg["html"] = 	loader.load("tumblr_message.html").generate(message=document["data"])
				else:
					msg["html"] = ""
					
				# Send the history
				#for waiter in ChatSocketHandler.waiters:
				try:
					self.write_message(msg)	
				except:
					logging.error("Error sending history", exc_info=True)
		
		else:
			parsed = tornado.escape.json_decode(message)
			chat = {
				"id": str(uuid.uuid4()),
				"body": parsed["body"],
				}
			#chat["html"] = tornado.escape.to_basestring(
			#	self.render_string("message.html", message=chat))

			#ChatSocketHandler.update_cache(chat)
			#ChatSocketHandler.send_updates(chat)
			
		#except NotImplementedError:
		#	update_status("Cannot parse message from client")



# A listener handles tweets are the received from the stream. 
def TwitterListener(message):
	
	try:
		# Get chat info and pass to client
		print "Twitter message id" +  message["id_str"]
	except:
		print "Problem getting message"
		return	
		

	# Figure out if a Tweet matches a sender.  If so, use that color and mode
	display_mode = -1	# Start with invalid mode
	id = 0
	
	for key, value in twitter_search_terms.iteritems():
		#print "@" + message["user"]["screen_name"] + "       " + key
		screen_name = "@" + message["user"]["screen_name"]
		if screen_name.lower() == key.lower():
			print "Matched user: " + key
			color1 = value["color1"]
			color2 = value["color2"]
			display_mode = value["mode"]
			id = message["id"]
			break
		
	# Didn't find a screen name match? Look for matches in search terms	
	if display_mode < 0:
		tweet_text =  message["text"].lower().encode('utf-8')
		print tweet_text
		for key, value in twitter_search_terms.iteritems():
			#print key.lower()
			if tweet_text.find(key.lower()) >= 0:
				print "Matched search term: " + key
				color1 = value["color1"]
				color2 = value["color2"]
				display_mode = value["mode"]
				id = message["id"] 
				break
	
	if display_mode < 0:
		# Message wasn't from a known sender and wasn't in the list of search terms.
		# Display a generic code
		print "Couldn't find a search term to match with -- using default colors"
		color1 = "FF00FF"
		color2 = "00FF00" 
		display_mode = 1
	
	logging.info("Display mode %d", display_mode)
	
	logging.info("sending message to %d waiters", len(ChatSocketHandler.waiters))
	
	message["user"]["profile_image_url"] = message["user"]["profile_image_url"].replace('_normal.png', '_bigger.png') # Use larger image
	
	# Hyperlink URLs
	tweet = {	"text": fix_urls(message["text"]), 
				"id" : message["id_str"], 
				"color1": color1, 
				"color2": color2,
				"name": message["user"]["screen_name"],
				"source": message["source"],  
				"length": len(message["text"]),
				"timestamp": datetime.datetime.now().strftime("%m/%d/%Y %H:%M:%S"),
				"profile_image_url": message["user"]["profile_image_url"]
			 }  			
	

	loader = Loader("./templates")
	tweet["html"] = loader.load("tweet_message.html").generate(message=tweet)
	  
	# Send the Twitter info to all the clients
	for waiter in ChatSocketHandler.waiters:
		try:
			waiter.write_message(tweet)
	
		except:
			logging.error("Error sending message", exc_info=True)
		
	# Send Arduino message
	arduino_url = arduino_ip + "?id=" + str(id) + "&color1=" + color1 + "&color2=" + color2 + "&mode=" + str(display_mode)
	try:
		print "Sending to Arduino: " + arduino_url
		r = requests.get(arduino_url, timeout=4)
		
	except requests.exceptions.Timeout:
		print "Arduino request timed out" 
                
	except:
		print "Cannot connect to Arduino"            

	# Save the tweet
   	db.posts.insert({'type':'tweet','data':tweet})




def process_instagram_tag_update(update):
	print "Got an instragram update: " + update



# Set things up
def main():

	# Set up Twitter stream
	getTwitterSearchTerms()
	stream = tweetstream.TweetStream(twitter_configuration)
	update_status("Twitter tracking terms: %s" % twitter_tracking_terms, 1)
	update_status("Twitter following ids: %s" % twitter_follows, 1)
	stream.fetch("/1/statuses/filter.json?track=" + twitter_tracking_terms + "&follow=" + twitter_follows, callback=TwitterListener)

	# Set up Twitter search term refresh (convert hours to milliseconds)
	twitter_def_callback = tornado.ioloop.PeriodicCallback(getTwitterSearchTerms, twitter_definition_refresh*60*60*1000)
	twitter_def_callback.start()

	# Set up Instagram periodic call backs	(convert seconds to milliseconds)
	#instagram_api.create_subscription(object='tag', object_id='bacon', aspect='media', callback_url='http://23.23.177.220:8008/instagram_subscription')
	
	# Set up Tumblr periodic call backs	(convert seconds to milliseconds)
	#tumblr_callback = tornado.ioloop.PeriodicCallback(check_tumblr, tumblr_check_time*1000)
	#tumblr_callback.start()




	# Set up Tornado to send data to clients
	tornado.options.parse_command_line()
	app = Application()
	app.listen(options.port)
	
	io_loop = tornado.ioloop.IOLoop.instance().start()
 





# Print timestamped status messages
def update_status(msg, debug_status=0):
	if debug_status <= debug_mode:
		timestamp = datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S")
		print "%s: %s" % ( timestamp, msg)





def getTwitterSearchTerms():

	global twitter_tracking_terms
	global twitter_search_terms
	global twitter_follows
	
	update_status("Looking up Twitter definitions", 1)

	# Get search terms from Google Docs spreadsheet published as a CSV file
	r = requests.get(twitter_def_url)
	f = StringIO.StringIO(r.text)
	reader = csv.reader(f, delimiter=',')
		
	# Get a list of all the search terms.  Keep track of both the exact term (e.g. @swarthmore and #swarthmore) as well as a list of unique search
	# terms for Twitter with no special characters
	twitter_tracking_terms = []
	twitter_follows_list = []
	for index,row in enumerate(reader):
	
		if index<1: 		# Skip first row
			continue

		# Store search term information
		twitter_search_terms[row[0]]= {'color1':row[1], 'color2':row[2], 'mode': row[3]}
		
		if row[5] != "":
			twitter_follows_list.append(row[5])
		
		# Set codes for LED mode
		if twitter_search_terms[row[0]]["mode"] == "party_mode":
			twitter_search_terms[row[0]]["mode"] = 1
		elif twitter_search_terms[row[0]]["mode"] == "pulse":
			twitter_search_terms[row[0]]["mode"] = 0
		else:
			twitter_search_terms[row[0]]["mode"] = 0

		# Remove any leading @ or # characters from the Twitter tracking terms list
		tracking_term = row[0]
		if tracking_term.startswith("#") or tracking_term.startswith("@"): 
			tracking_term = tracking_term[1:]
		
		twitter_tracking_terms.append(tracking_term)		

 
	# Remove any duplicate items from the tracking terms and follows by converting it into a set
	# Then convert it to a string
	twitter_tracking_terms =  ','.join(set(twitter_tracking_terms))
	twitter_follows = ",".join(set(twitter_follows_list))
	
	update_status("Done looking up Twitter definitions", 1)



# Create hyperlinks to URLs included in messages
def fix_urls(text):

	urls = '(?: %s)' % '|'.join("""http telnet gopher file wais ftp""".split())
	ltrs = r'\w'
	gunk = r'/#~:.?+=&%@!\-'
	punc = r'.:?\-'
	any = "%(ltrs)s%(gunk)s%(punc)s" % { 'ltrs' : ltrs,
										 'gunk' : gunk,
										 'punc' : punc }

	url = r"""
		\b                            # start at word boundary
			%(urls)s    :             # need resource and a colon
			[%(any)s]  +?             # followed by one or more
									  #  of any valid character, but
									  #  be conservative and take only
									  #  what you need to....
		(?=                           # look-ahead non-consumptive assertion
				[%(punc)s]*           # either 0 or more punctuation
				(?:   [^%(any)s]      #  followed by a non-url char
					|                 #   or end of the string
					  $
				)
		)
		""" % {'urls' : urls,
			   'any' : any,
			   'punc' : punc }

	url_re = re.compile(url, re.VERBOSE | re.MULTILINE)

	for url in url_re.findall(text):
		print url
		text = text.replace(url, '<a href="%(url)s">%(url)s</a>' % {"url" : url})

	return text


if __name__ == "__main__":
    main()
