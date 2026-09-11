import json
from host import host

context = host('context')
note = context['parameters']['note']
host('eval', {'expression': "(() => { let note = document.createElement('aside'); note.textContent = " + json.dumps(note) + "; document.body.prepend(note); return true; })()"})
host('result', {'noteAdded': True})
