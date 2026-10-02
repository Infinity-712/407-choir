"""Generate server-only settings. Never print or transfer the shared TURN secret."""
import json, os, secrets, shutil
from pathlib import Path

base=Path(__file__).resolve().parent
state=base/'state'
state.mkdir(mode=0o700,exist_ok=True)
for name in ['certs','acme','certbot-work','certbot-log']:
    (state/name).mkdir(exist_ok=True)
secret_file=state/'turn-secret'
if not secret_file.exists():
    secret_file.write_text(secrets.token_hex(32))
    secret_file.chmod(0o600)
secret=secret_file.read_text().strip()
ip='124.221.108.122'
urls=[f'turn:{ip}:3478?transport=udp',f'turn:{ip}:3478?transport=tcp',f'turns:{ip}:5349?transport=tcp']
env=state/'app.env'
env.write_text('PORT=3001\nICE_SERVERS='+json.dumps([{'urls':f'stun:{ip}:3478'}])+'\nTURN_SHARED_SECRET='+secret+'\nTURN_URLS='+json.dumps(urls)+'\n')
env.chmod(0o600)
turn=state/'turnserver.conf'
turn.write_text(f'''listening-port=3478
tls-listening-port=5349
listening-ip=10.0.0.15
relay-ip=10.0.0.15
external-ip={ip}/10.0.0.15
min-port=49160
max-port=49569
fingerprint
use-auth-secret
static-auth-secret={secret}
realm=407-choir
cert=/etc/letsencrypt/live/{ip}/fullchain.pem
pkey=/etc/letsencrypt/live/{ip}/privkey.pem
no-cli
no-multicast-peers
no-tcp-relay
no-dtls
user-quota=16
total-quota=512
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
log-file=stdout
simple-log
''')
turn.chmod(0o600)
if not (state/'nginx.conf').exists():
    shutil.copyfile(base/'nginx-http.conf',state/'nginx.conf')
print('Server settings initialized; secrets kept in deploy/state.')
