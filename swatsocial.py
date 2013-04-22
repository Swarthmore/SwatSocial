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
from tornado.options import define, options
from tornado.template import Template, Loader
from instagram.client import InstagramAPI
import motor

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
twitter_search_terms = {}
twitter_definition_refresh = Config.getint('Twitter', "twitter_definition_refresh")


### Instagram Configuration ###
instagram_api = InstagramAPI(access_token=Config.get('Instagram', "instagram_access_token"))
instagram_last_location_id = 0
instagram_last_tag_id = 0
instagram_check_time = Config.getint('Instagram', "instagram_check_time")


### Tumblr Configuration ###
tumblr_api_url = Config.get('Tumblr', "tumblr_api_url")	
tumblr_api_key = Config.get('Tumblr', "tumblr_api_key")	
tumblr_check_time = Config.getint('Tumblr', "tumblr_check_time")
tumblr_last_id = 0



# Set up Motor and connection to MongoDB
client = motor.MotorClient('ec2-50-19-28-191.compute-1.amazonaws.com', 27017).open_sync()
db = client['swatsocial']


class Application(tornado.web.Application):

	

	def __init__(self):
		handlers = [
			(r"/", MainHandler),
			(r"/chatsocket", ChatSocketHandler),
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
   			db.instagram.insert({"id": media.id, "created_time": media.created_time}, callback=saved_instagram)
			
			loader = Loader("./templates")
			post["timestamp"] = datetime.datetime.fromtimestamp(int(post["timestamp"])).strftime("%m/%d/%Y %H:%M:%S")
			post["html"] = loader.load("tumblr_message.html").generate(message=post)	
		
		
			# Send the Tumblr info to all the clients
			for waiter in ChatSocketHandler.waiters:
				try:
					waiter.write_message(post)	
				except:
					logging.error("Error sending Tumblr message", exc_info=True)	

	# Record the highest post id
	for post in posts["response"]:
		if post["id"] > tumblr_last_id:
			tumblr_last_id = post["id"]



def check_instagram():

	global instagram_last_location_id
	global instagram_last_tag_id

	update_status("Searching for instagram.  Last location id is %s" % instagram_last_location_id, 1)
	
	# 45845732 or 10192151 is Swarthmore College --> don't return recent links
	# Note: "39556451" is the id for the Swarthmore location
	ig_media, next =  instagram_api.location_recent_media(100, 999999999999999999999999, 39556451)
 	msg = {}
 	
	# Grab any new pictures
	for media in ig_media:
		if media.id > instagram_last_location_id:
			# This is a new picture -- post it
			update_status("Found a new Instragram post by %s" % media.user.username, 1)

			# Save the Instagram post
			# Async insert; callback is executed when insert completes
   			db.instagram.insert({"id": media.id, "created_time": media.created_time}, callback=saved_instagram)

			# Send media to template and post it
			loader = Loader("./templates")
			msg["html"] = loader.load("instagram_message.html").generate(message=media)

			# Send the Instagram info to all the clients
			for waiter in ChatSocketHandler.waiters:
				try:
					waiter.write_message(msg)	
				except:
					logging.error("Error sending Instrgram message", exc_info=True)

 				
	# Find the highest id and save it
	for media in ig_media:
		if media.id > instagram_last_location_id:
			instagram_last_location_id = media.id
			

	update_status("Searching for instagram.  Last tag id is %s" % instagram_last_tag_id, 1)
	ig_media, next = instagram_api.tag_recent_media(100, 99999999999999999999999, "swarthmore")
	 
	for media in ig_media:
		if media.id > instagram_last_tag_id:
			# This is a new picture -- post it
			update_status("Found a new Instragram post by %s at %s" % (media.user.username, media.created_time), 1)
	
			# Save the Instagram post
			# Async insert; callback is executed when insert completes
   			db.instagram.insert({media}, callback=saved_instagram)

			# Send media to template and post it
			loader = Loader("./templates")
			msg["html"] = loader.load("instagram_message.html").generate(message=media)

			# Send the Instagram info to all the clients
			for waiter in ChatSocketHandler.waiters:
				try:
					waiter.write_message(msg)	
				except:
					logging.error("Error sending Instrgram message", exc_info=True)	
	
				
	# Find the highest id and save it
	for media in ig_media:
		if media.id > instagram_last_tag_id:
			instagram_last_tag_id = media.id






class MainHandler(tornado.web.RequestHandler):
    def get(self):
        self.render("index.html", messages=ChatSocketHandler.cache)



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
        logging.info("got message %r", message)
        parsed = tornado.escape.json_decode(message)
        chat = {
            "id": str(uuid.uuid4()),
            "body": parsed["body"],
            }
        chat["html"] = tornado.escape.to_basestring(
            self.render_string("message.html", message=chat))

        ChatSocketHandler.update_cache(chat)
        ChatSocketHandler.send_updates(chat)




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
		tweet_text =  message["text"].lower()
		print tweet_text
		for key, value in twitter_search_terms.iteritems():
			print key.lower()
			if tweet_text.find(key.lower()) > 0:
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
	tweet["html"] = loader.load("tweet_message.html").generate(tweet=tweet)

	# Save the tweet
	# Async insert; callback is executed when insert completes
   	db.tweets.insert({'tweet': tweet}, callback=saved_tweet)
	
	  
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


 
def saved_tweet(result, error):
	if error:
		update_status("Could not save Tweet to database: %s" % error, 1)
	else:
		update_status("Tweet saved to database", 1)
	

def saved_instagram(result, error):
	if error:
		update_status("Could not save Instagram to database: %s" % error, 1)
	else:
		update_status("Instagram saved to database", 1)

def saved_tumblr(result, error):
	if error:
		update_status("Could not save Tumblr postto database: %s" % error, 1)
	else:
		update_status("Tumblr post saved to database", 1)


# Set things up
def main():

	# Set up Twitter stream
	getTwitterSearchTerms()
	stream = tweetstream.TweetStream(twitter_configuration)
	update_status("Twitter tracking terms: %s" % twitter_tracking_terms, 1)
	stream.fetch("/1/statuses/filter.json?track=" + twitter_tracking_terms, callback=TwitterListener)

	# Set up Twitter search term refresh (convert hours to milliseconds)
	twitter_def_callback = tornado.ioloop.PeriodicCallback(getTwitterSearchTerms, twitter_definition_refresh*60*60*1000)
	twitter_def_callback.start()

	# Set up Instagram periodic call backs	(convert seconds to milliseconds)
	instagram_callback = tornado.ioloop.PeriodicCallback(check_instagram, instagram_check_time*1000)
	instagram_callback.start()

	# Set up Tumblr periodic call backs	(convert seconds to milliseconds)
	tumblr_callback = tornado.ioloop.PeriodicCallback(check_tumblr, tumblr_check_time*1000)
	tumblr_callback.start()




	# Set up Tornado to send data to clients
	tornado.options.parse_command_line()
	app = Application()
	app.listen(options.port)
	
	tornado.ioloop.IOLoop.instance().start()
 



# Print timestamped status messages
def update_status(msg, debug_status=0):
	if debug_status <= debug_mode:
		timestamp = datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S")
		print "%s: %s" % ( timestamp, msg)





def getTwitterSearchTerms():

	global twitter_tracking_terms
	global twitter_search_terms

	update_status("Looking up Twitter definitions", 1)

	# Get search terms from Google Docs spreadsheet published as a CSV file
	r = requests.get(twitter_def_url)
	f = StringIO.StringIO(r.text)
	reader = csv.reader(f, delimiter=',')
		
	# Get a list of all the search terms.  Keep track of both the exact term (e.g. @swarthmore and #swarthmore) as well as a list of unique search
	# terms for Twitter with no special characters
	twitter_tracking_terms = []

	for index,row in enumerate(reader):
	
		if index<1: 		# Skip first row
			continue

		# Store search term information
		twitter_search_terms[row[0]]= {'color1':row[1], 'color2':row[2], 'mode': row[3]}
		
		# Set codes for LED mode
		if twitter_search_terms[row[0]]["mode"] == "party_mode":
			twitter_search_terms[row[0]]["mode"] = 1
		elif twitter_search_terms[row[0]]["mode"] == "pulse":
			twitter_search_terms[row[0]]["mode"] = 0
		else:
			twitter_search_terms[row[0]]["mode"] = 0

		# Remove any non-alphanumeric characters from the Twitter tracking terms list
		twitter_tracking_terms.append(''.join(e for e in row[0] if e.isalnum()))		

 
	# Remove any duplicate items from the tracking terms by converting it into a set
	# Then convert it to a string
	twitter_tracking_terms =  ','.join(set(twitter_tracking_terms))

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
