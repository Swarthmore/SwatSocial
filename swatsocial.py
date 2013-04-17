#!/usr/bin/env python

# Program to capture social media, display it, and integrate with an Arduino.



"""Simplified chat demo for websockets.

Authentication, error handling, etc are left as an exercise for the reader :)
"""

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
from instagram.client import InstagramAPI


# Load config 
Config = ConfigParser.ConfigParser()
Config.read("swatsocial.conf")



### Tornado Configuration ###
define("port", default=Config.get('app', "port"), help="run on the given port", type=int)



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

twitter_tracking_terms = []
twitter_search_terms = {}



### Instagram Configuration ###
instagram_api = InstagramAPI(access_token=Config.get('Instagram', "instagram_access_token"))
instagram_last_location_id = 0
instagram_last_tag_id = 0




class Application(tornado.web.Application):
    def __init__(self):
        handlers = [
            (r"/", MainHandler),
            (r"/chatsocket", ChatSocketHandler),
        ]
        settings = dict(
            template_path=os.path.join(os.path.dirname(__file__), "templates"),
            static_path=os.path.join(os.path.dirname(__file__), "static"),
            debug=True             
        )
        
        tornado.web.Application.__init__(self, handlers, **settings)







def check_instagram():

	global instagram_last_location_id
	global instagram_last_tag_id

	print "Searching for instagram"
	image_list = ""
	
	
	
	# Note: "39556451" is the id for the Swarthmore location
	ig_media, next =  instagram_api.location_recent_media(100, 99999999999999999999999, 39556451)

	# Grab any new pictures
	for media in ig_media:
		if media.id > instagram_last_location_id:
			caption = media.user.username
			if hasattr(media.caption, 'text'): 
				caption +=  ": "  + media.caption.text
			image_list +=  "<div class='message'><img style='align: left;vertical-align:text-top;margin:5px' src='" + media.images['thumbnail'].url + "'>" + caption + "</div>"
				
	# Find the highest id and save it
	for media in ig_media:
		if media.id > instagram_last_location_id:
			instagram_last_location_id = media.id
			
	
	
	ig_media, next = instagram_api.tag_recent_media(100, 99999999999999999, "swarthmore")
	# Grab any new pictures
	for media in ig_media:
		if media.id > instagram_last_tag_id:
			image_list +=  "<div class='message' style='font-size:50%'><img style='align: left;vertical-align:text-top;' src='" + media.images['thumbnail'].url + "'>" + media.user.username + ": " + media.caption.text + "</div>"
				 

	# Find the highest id and save it
	for media in ig_media:
		if media.id > instagram_last_tag_id:
			instagram_last_tag_id = media.id

	if image_list != "":	
		message = {"html" : "<div>" + image_list + "</div>"}

		# Send the Instagram info to all the clients
		for waiter in ChatSocketHandler.waiters:
			try:
			
				waiter.write_message(message)
			
			except:
				logging.error("Error sending message", exc_info=True)







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
	
	# Hyperlink URLs
	tweet = {"body": fix_urls(message["text"]), "id" : message["id_str"], "color1": color1, "color2": color2}  			
	tweet["html"] = '<div class="message" id="' + tweet["id"] + '"><span style="background-color:#' +color1 + '"><b>' + message["user"]["screen_name"] + '</b></span>&nbsp;&nbsp' + tweet["body"] + '<BR><div style="width:100%;font-size:50%;text-align:right">' + datetime.datetime.now().strftime("%m/%d/%Y %H:%M:%S") + '</div>'

	
	
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


# Set things up
def main():

	# Get search terms from Google Docs spreadsheet published as a CSV file
	r = requests.get(twitter_def_url)
	f = StringIO.StringIO(r.text)
	reader = csv.reader(f, delimiter=',')
	
	# Skip first three rows
	reader.next
	reader.next
	reader.next
	
	# Get a list of all the search terms.  Keep track of both the exact term (e.g. @swarthmore and #swarthmore) as well as a list of unique search
	# terms for Twitter with no special characters
	twitter_tracking_terms = []


	for index,row in enumerate(reader):
	
		if index<3: 		# Skip first three rows
			continue

		# Store search term information
		twitter_search_terms[row[0]]= {'color1':row[3], 'color2':row[5], 'mode': row[6]}
		
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
	twitter_tracking_terms =  ','.join(set(twitter_tracking_terms))


	# Set up Twitter stream
	stream = tweetstream.TweetStream(twitter_configuration)
	stream.fetch("/1/statuses/filter.json?track=" + twitter_tracking_terms, callback=TwitterListener)


	# Set up Instagram call backs	
	instagram_callback = tornado.ioloop.PeriodicCallback(check_instagram, 10000)
	instagram_callback.start()

	# Set up Tornado to send data to clients
	tornado.options.parse_command_line()
	app = Application()
	app.listen(options.port)

	
	tornado.ioloop.IOLoop.instance().start()





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
