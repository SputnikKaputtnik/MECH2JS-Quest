"""Build our standalone development APK around a pinned, precompiled OpenXR/WebXR engine.

Only our launcher/content provider is newly compiled. The engine remains a versioned
binary dependency, with upstream sources/notices retained. Original game files are
never placed in this APK. Output, tools and signing key live outside the repository.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--runtime', type=Path, required=True)
parser.add_argument('--apktool', type=Path, required=True)
parser.add_argument('--sdk', type=Path, required=True)
parser.add_argument('--work', type=Path, required=True)
args = parser.parse_args()
here = Path(__file__).resolve().parent
repo = here.parent.parent
config = json.loads((here / 'runtime.json').read_text(encoding='utf-8'))
for file, digest in [(args.runtime, config['sha256']), (args.apktool, config['apktoolSha256'])]:
    if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
        raise SystemExit(f'Unverified dependency: {file}')
work = args.work.resolve()
if work.is_relative_to(repo):
    raise SystemExit('Build output and signing key must be outside the repository')
work.mkdir(parents=True, exist_ok=True)
build = work / ('build-' + str(time.time_ns()))
build.mkdir()
base = build / 'package'
def run(*command):
    subprocess.run([str(part) for part in command], check=True)

run('java', '-jar', args.apktool.resolve(), 'd', '--no-src', '-p', work / 'framework', '-o', base, args.runtime.resolve())
ns = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ns)
def attr(name): return '{' + ns + '}' + name
manifest = ET.parse(base / 'AndroidManifest.xml')
root = manifest.getroot()
old = root.get('package')
root.set('package', config['package'])
for element in root.iter():
    for key in [attr('authorities'), attr('permission')]:
        if element.get(key): element.set(key, element.get(key).replace(old, config['package']))
    if element.tag in ['permission', 'uses-permission'] and element.get(attr('name'), '').startswith(old + '.'):
        element.set(attr('name'), element.get(attr('name')).replace(old, config['package'], 1))
app = root.find('application')
app.set(attr('label'), 'MECH2 Quest')
app.set(attr('icon'), '@drawable/mech2_icon')
app.set(attr('roundIcon'), '@drawable/mech2_icon')
app.set(attr('debuggable'), 'true')
app.set(attr('allowBackup'), 'false')
for metadata in app.findall('meta-data'):
    if metadata.get(attr('name')) == 'com.oculus.supportedDevices':
        metadata.set(attr('value'), 'quest2|questpro|quest3|quest3s')
for activity in list(app.findall('activity')):
    name = activity.get(attr('name'), '')
    if name.startswith('androidx.test.'):
        app.remove(activity)
    elif name == 'com.igalia.wolvic.VRBrowserActivity':
        for intent in activity.findall('intent-filter'): activity.remove(intent)
        activity.set(attr('exported'), 'false')
launcher = ET.SubElement(app, 'activity', {
    attr('name'): 'quest.mech2.BootstrapActivity', attr('exported'): 'true',
    attr('label'): 'MECH2 Quest', attr('screenOrientation'): 'landscape',
    attr('theme'): '@android:style/Theme.Black.NoTitleBar.Fullscreen'})
intent = ET.SubElement(launcher, 'intent-filter')
ET.SubElement(intent, 'action', {attr('name'): 'android.intent.action.MAIN'})
for category in ['android.intent.category.LAUNCHER', 'com.oculus.intent.category.VR']:
    ET.SubElement(intent, 'category', {attr('name'): category})
ET.SubElement(app, 'provider', {attr('name'): 'quest.mech2.RuntimeProvider',
    attr('authorities'): config['package'] + '.localcontent', attr('exported'): 'false', attr('initOrder'): '1000'})
manifest.write(base / 'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
(base / 'res/drawable/mech2_icon.xml').write_text('''<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="128dp" android:height="128dp" android:viewportWidth="128" android:viewportHeight="128">
<path android:fillColor="#17212a" android:pathData="M0,0h128v128H0z"/>
<path android:fillColor="#ba3929" android:pathData="M24,24h80l12,22v54H12V46z"/>
<path android:fillColor="#e7dfba" android:pathData="M25,46h10l10,18 10,-18h10v42H54V65L45,81 36,65v23H25z M74,46h27v9L85,78h16v10H72V78l17,-22H74z"/>
</vector>''', encoding='utf-8')
assets = base / 'assets/mech2'
shutil.copytree(repo / 'dist', assets)
(assets / 'runtime-notices.txt').write_text(
    'MECH2 Quest embeds Wolvic Chromium 1.4 / OpenXR. Not affiliated with Igalia or Mozilla.\n'
    'Wolvic: MPL-2.0. Upstream notices and engine assets remain in this package.\n'
    'Source: ' + config['source'] + '\nChromium source: ' + config['engineSource'] + '\n'
    'Integration source: https://github.com/SputnikKaputtnik/MECH2JS-Quest/tree/vr-mode/native/android\n', encoding='utf-8')
classes = build / 'classes'
classes.mkdir()
android = args.sdk / 'platforms/android-35/android.jar'
tools = args.sdk / 'build-tools/36.0.0'
sources = list((here / 'src').rglob('*.java'))
run('javac', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', android, '-d', classes, *sources)
jar = build / 'bootstrap.jar'
run('jar', 'cf', jar, '-C', classes, '.')
dex = build / 'dex'
dex.mkdir()
run(tools / 'd8.bat', '--lib', android, '--min-api', '26', '--output', dex, jar)
shutil.copyfile(dex / 'classes.dex', base / 'classes2.dex')
unsigned = build / 'unsigned.apk'
run('java', '-jar', args.apktool.resolve(), 'b', '-p', work / 'framework', '-o', unsigned, base)
aligned = build / 'aligned.apk'
run(tools / 'zipalign.exe', '-P', '16', '-f', '4', unsigned, aligned)
key = work / 'mech2quest-development.jks'
if not key.exists():
    run('keytool', '-genkeypair', '-keystore', key, '-storepass', 'android', '-keypass', 'android',
        '-alias', 'mech2quest', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '3650',
        '-dname', 'CN=MECH2 Quest Development')
output = work / 'MECH2-Quest-dev.apk'
run(tools / 'apksigner.bat', 'sign', '--ks', key, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', output, aligned)
run(tools / 'apksigner.bat', 'verify', '--verbose', output)
run(tools / 'zipalign.exe', '-c', '-P', '16', '4', output)
with zipfile.ZipFile(output) as apk:
    assert 'classes2.dex' in apk.namelist()
    assert 'assets/mech2/index.html' in apk.namelist()
    assert not any(name.upper().endswith(('.PRJ', '.MW2', '.EXE', '.CUE')) for name in apk.namelist())
report = {'package': config['package'], 'apk': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    'runtime': config, 'appBuild': json.loads((repo / 'dist/quest-shell.json').read_text())['id'], 'kind': 'development',
    'deviceVerified': False, 'originalGameFilesBundled': False}
(work / 'build-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
