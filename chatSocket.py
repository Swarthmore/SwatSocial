import tornado.websocket


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
		
			# Get latest posts, sorted by most recent last
			cursor = db.posts.find(limit=10).sort("_id",-1)
			recentPosts=[]
			for doc in cursor:
				recentPosts.append(doc)
			recentPosts.reverse()
			
			for document in recentPosts:
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
		
			update_status("Cannot parse message from client")
			
			#parsed = tornado.escape.json_decode(message)
			#chat = {
			#	"id": str(uuid.uuid4()),
			#	"body": parsed["body"],
			#	}
			#chat["html"] = tornado.escape.to_basestring(
			#	self.render_string("message.html", message=chat))

			#ChatSocketHandler.update_cache(chat)
			#ChatSocketHandler.send_updates(chat)
			
		#except NotImplementedError:
		#	update_status("Cannot parse message from client")
