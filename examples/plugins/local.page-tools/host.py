import json
import os
import subprocess


def host(method, arguments=None):
    response = subprocess.run(
        [os.environ['BMUX_CLI'], 'plugin', 'host', method, '--stdin'],
        input=json.dumps(arguments or {}), capture_output=True, text=True, check=True,
    )
    return json.loads(response.stdout)['result']
