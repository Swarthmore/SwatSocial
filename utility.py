#!/usr/bin/env python

import re
import datetime
import time

debug_mode = 1		# Default debug mode

 
def set_debug_mode(new_debug_mode):
	debug_mode = new_debug_mode
	return debug_mode
	

	
	

# Print timestamped status messages
def update_status(msg, debug_status=0):
	if debug_status <= debug_mode:
		timestamp = datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S")
		print "%s: %s" % ( timestamp, msg)









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


