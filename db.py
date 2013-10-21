from pymongo import MongoClient

db_port = 27017
db = ""


def connect(db_host, db_name):
	global db
	client = MongoClient(db_host, db_port)
	db = client[db_name]



def insert(data):
	db.posts.insert(data)
	
	
def save(data):
	db.posts.save(data)
	
