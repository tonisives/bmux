import json
from host import host

headings = host('eval', {'expression': "Array.from(document.querySelectorAll('h1,h2,h3')).map((node,index)=>({id:String(index),label:node.textContent.trim() || 'Untitled heading'}))"})
if headings:
    selected = host('ui', {'kind': 'pick', 'title': 'Jump to heading', 'items': headings})
    host('eval', {'expression': "document.querySelectorAll('h1,h2,h3')[" + json.dumps(int(selected)) + "].scrollIntoView(); true"})
    host('result', {'scrolled': True})
else:
    host('progress', {'percent': 100, 'message': 'No headings on this page'})
