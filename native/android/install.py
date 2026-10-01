"""Install a development APK and verified private game data into its own sandbox.

Uses run-as over ADB; does not grant shared-storage access or touch Quest Browser.
Only game-data is copied. Existing pilot saves/settings in the profile are retained.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--adb', required=True)
parser.add_argument('--apk', type=Path, required=True)
parser.add_argument('--data', type=Path, required=True)
parser.add_argument('--work', type=Path, required=True)
parser.add_argument('--serial', required=True)
parser.add_argument('--launch', action='store_true')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
if args.work.resolve().is_relative_to(repo) or args.data.resolve().is_relative_to(repo):
    raise SystemExit('Private data and transfer archive must be outside the repository')
package = json.loads((Path(__file__).parent / 'runtime.json').read_text(encoding='utf-8'))['package']
manifest = json.loads((args.data / 'manifest.json').read_text(encoding='utf-8'))
assert manifest['version'] == 1 and manifest['chunkBytes'] == 4 * 1024 * 1024
assert {'MW2.PRJ', 'MW2.EXE', 'MW2SHELL.EXE'} <= {item['name'] for item in manifest['files']}
args.work.mkdir(parents=True, exist_ok=True)
archive = args.work / 'private-game-data.tar'
with tarfile.open(archive, 'w') as tar:
    for item in manifest['files']:
        name = item['name']
        assert re.fullmatch(r'[A-Z0-9_/-]+(?:\.[A-Z0-9_]+)?', name) and not name.startswith('/')
        file = args.data / name
        assert file.stat().st_size == item['size'], f'Wrong size: {name}'
        with file.open('rb') as content:
            hashes = []
            while chunk := content.read(manifest['chunkBytes']):
                hashes.append(hashlib.sha256(chunk).hexdigest())
        assert hashes == item['chunks'], f'Corrupt content: {name}'
        tar.add(file, arcname='game-data/' + name, recursive=False)
    tar.add(args.data / 'manifest.json', arcname='game-data/manifest.json', recursive=False)

adb = [args.adb, '-s', args.serial]
def run(*command, **kwargs):
    return subprocess.run(adb + list(command), check=True, **kwargs)
run('install', '-r', str(args.apk.resolve()))
run('shell', 'am', 'force-stop', package)
run('shell', 'run-as', package, 'mkdir', '-p', 'files')
# ADB exec-in stdin was truncated without a nonzero exit code on a Windows host.
# Stage a file through ADB's sync protocol, then let the app UID extract it.
remote = '/data/local/tmp/mech2quest-data.tar'
run('push', str(archive.resolve()), remote)
run('shell', 'run-as', package, 'tar', '-xf', remote, '-C', 'files')
check = run('exec-out', 'run-as', package, 'cat', 'files/game-data/manifest.json', capture_output=True)
assert json.loads(check.stdout) == manifest, 'Incomplete manifest transfer'
# Verify every full file on-device, not just a transfer success exit code.
for item in manifest['files']:
    actual = run('exec-out', 'run-as', package, 'sha256sum', 'files/game-data/' + item['name'], capture_output=True)
    with (args.data / item['name']).open('rb') as source:
        expected = hashlib.file_digest(source, 'sha256').hexdigest()
    assert actual.stdout.decode().split()[0] == expected, 'Device content hash mismatch: ' + item['name']
print(f'Installed {package}; verified {len(manifest["files"])} private content files on device.')
run('shell', 'rm', remote)
if args.launch:
    run('shell', 'am', 'start', '-n', package + '/quest.mech2.BootstrapActivity')
