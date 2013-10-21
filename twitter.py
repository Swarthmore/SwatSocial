from twython import TwythonStreamer
from tornado.template import Template, Loader
from utility import *
import requests
import StringIO
import csv
import logging
from chatSocket import *
import arduino 
import db
import urllib

twitter_tracking_terms = ""
twitter_follows = ""
twitter_search_terms = {}

# A listener handles tweets are the received from the stream. 
class TwitterStreamer(TwythonStreamer):

	def on_error(self, status_code, data):
		logging.error("Error with Twitter streamer: %s  %s" % (status_code, data), exc_info=True) 

	def on_success(self, message):
		if 'text' in message:
			print message['text'].encode('utf-8')
		# Want to disconnect after the first result?
		# self.disconnect()



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
		arduino.send_arduino_message(str(id), color1, color2, str(display_mode))   

		# Save the tweet
		db.insert({'type':'tweet','data':tweet})
		
		
		
		
		
def getTwitterSearchTerms(twitter_def_url):

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
	update_status("Twitter tracking terms: %s" % twitter_tracking_terms, 1)
	update_status("Twitter following ids: %s" % twitter_follows, 1)
	
	
	
	
# Start Twitter steaming
# Get search terms, configure streaming, and start streaming	
def setup_twitter_stream(twitter_def_url, twitter_configuration):

	getTwitterSearchTerms(twitter_def_url)
	
	stream = TwitterStreamer(
			twitter_configuration["twitter_consumer_key"],
			twitter_configuration["twitter_consumer_secret"],
			twitter_configuration["twitter_access_token"],
			twitter_configuration["twitter_access_token_secret"]
			)

	#filter_string = "track=%s&follow=%s" % ( twitter_tracking_terms,  twitter_follows )
	#filter_string = "track=%s" % urllib.quote(twitter_tracking_terms)
	#print filter_string
	stream.statuses.filter(track = twitter_tracking_terms, follow=twitter_follows)
	