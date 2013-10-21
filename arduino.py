import requests
from utility import *

arduino_ip = ""


def set_arduino_ip(new_arduino_ip):
	global arduino_ip
	arduino_ip = new_arduino_ip
	update_status("Arduino IP set to: %s" % arduino_ip)


# Send Arduino message
def send_arduino_message(message_id, color1, color2, display_mode): 

	update_status("Arduino IP set to: %s" % arduino_ip)

	arduino_url = arduino_ip + "?id=" + str(message_id) + "&color1=" + color1 + "&color2=" + color2 + "&mode=" + str(display_mode)
	try:
		print "Sending to Arduino: " + arduino_url
		r = requests.get(arduino_url, timeout=4)

	except requests.exceptions.Timeout:
		print "Arduino request timed out" 
		
	except:
		print "Cannot connect to Arduino"     