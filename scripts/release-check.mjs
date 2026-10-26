// Google Play release preflight. Checks the source configuration and, when given one, a built APK or AAB.
// Run: node scripts/release-check.mjs [build-output/app.aab] [build-output/app.apk]
// Env: ANDROID_HOME (default D:\Android\sdk), BUNDLETOOL (path to bundletool-all.jar, needed for an AAB's manifest).
// Exit code 1 if anything FAILs. WARN items need a person to look; they do not block a test build.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const root = join(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? 'D:\\Android\\sdk';
const MIN_TARGET_SDK = 36; // Required for new apps and updates since 2026-08-31 (developer.android.com/google/play/requirements/target-sdk).
const SAMPLE_ADMOB = 'ca-app-pub-3940256099942544'; // Google's sample publisher id: test ads only.
/** Every permission the release is expected to declare. Anything else needs a reason before it ships. */
const EXPECTED_PERMISSIONS = new Set([
  'android.permission.INTERNET', 'android.permission.VIBRATE', 'android.permission.WAKE_LOCK', 'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.MODIFY_AUDIO_SETTINGS', 'com.android.vending.BILLING', 'com.google.android.gms.permission.AD_ID',
  'android.permission.ACCESS_ADSERVICES_AD_ID', 'android.permission.ACCESS_ADSERVICES_ATTRIBUTION', 'android.permission.ACCESS_ADSERVICES_TOPICS',
  'com.lightkeeper.mirrormaze.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
]);

const results = [];
const report = (status, item, detail = '') => results.push({ status, item, detail });
const read = path => readFileSync(join(root, path), 'utf8');
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
const buildTools = () => {
  const dir = join(sdk, 'build-tools');
  const latest = readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  return join(dir, latest);
};
const tool = (name) => join(buildTools(), process.platform === 'win32' ? `${name}.exe` : name);
// apksigner's launcher is a .bat on Windows, which Node will not start without a shell; its jar runs the same.
const apksigner = args => run('java', ['-jar', join(buildTools(), 'lib', 'apksigner.jar'), ...args]);

// ---------------------------------------------------------------------------------------------------------------------
// Source configuration
function checkSource() {
  const flag = (path, name) => new RegExp(`${name}: boolean = (true|false)`).exec(read(path))?.[1];
  for (const [path, name] of [['src/game/testing.ts', 'UNLOCK_ALL'], ['src/world/perf.ts', 'PERF_HUD']]) {
    const value = flag(path, name);
    report(value === 'false' ? 'PASS' : 'FAIL', `${name} is off (${path})`, `value: ${value ?? 'not found'}`);
  }
  const app = JSON.parse(read('app.json')).expo;
  const plugin = name => app.plugins.find(p => (Array.isArray(p) ? p[0] : p) === name);
  const adsAppId = plugin('react-native-google-mobile-ads')?.[1]?.androidAppId ?? '';
  report(adsAppId && !adsAppId.startsWith(SAMPLE_ADMOB) ? 'PASS' : 'FAIL', 'AdMob app id is the game\'s own (app.json)',
    adsAppId.startsWith(SAMPLE_ADMOB) ? `${adsAppId} is Google's sample id: only test ads would show` : adsAppId || 'empty');
  const config = read('src/config/googlePlay.ts');
  const unit = /INTERSTITIAL_UNIT[^=]*=\s*\{\s*android:\s*'([^']*)'/.exec(config)?.[1] ?? '';
  report(unit && !unit.startsWith(SAMPLE_ADMOB) ? 'PASS' : 'FAIL', 'Interstitial ad unit is set (src/config/googlePlay.ts)',
    unit || 'empty: release builds fall back to Google\'s test unit');
  const privacy = /PRIVACY_POLICY_URL[^=]*=\s*'([^']*)'/.exec(config)?.[1] ?? '';
  report(/^https:\/\/\S+$/.test(privacy) ? 'PASS' : 'FAIL', 'Privacy policy URL is set (in-app link, Play User Data policy)', privacy || 'empty');
  const product = /REMOVE_ADS_PRODUCT\s*=\s*'([^']*)'/.exec(config)?.[1];
  report('INFO', 'Remove Ads product id', `${product}: must match an active one-time product in Play Console`);
  const games = plugin('./modules/google-play/app.plugin.js')?.[1]?.gamesAppId ?? '';
  report(games ? 'PASS' : 'WARN', 'Play Games project id (optional)', games || 'empty: Play Games, achievements and cloud save stay hidden');
  const blocked = new Set(app.android.blockedPermissions ?? []);
  const needed = ['RECORD_AUDIO', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW']
    .map(p => `android.permission.${p}`).filter(p => !blocked.has(p));
  report(needed.length ? 'FAIL' : 'PASS', 'Unused library permissions are blocked (app.json)', needed.join(', ') || '6 blocked');
  const caption = /v(\d+(?:\.\d+)*)<\/GameText>/.exec(read('src/screens/Modals.tsx'))?.[1];
  report(caption && app.version.startsWith(caption) ? 'PASS' : 'WARN', 'Settings shows the release version',
    `app.json ${app.version} (versionCode ${app.android.versionCode}), Settings "v${caption}"`);
  report('INFO', 'versionCode must be higher than every build already uploaded to Play Console', String(app.android.versionCode));
}

// ---------------------------------------------------------------------------------------------------------------------
// Artifacts
/** The entries of a zip file (APK, AAB), read without extracting it. */
function zipEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip file');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    const method = buffer.readUInt16LE(at + 10), size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28), extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    entries.set(name, { method, local, size, read() {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    } });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

/** LOAD segment alignments of a 64-bit ELF shared library. */
function loadAlignments(elf) {
  if (elf.readUInt32BE(0) !== 0x7f454c46 || elf[4] !== 2) return [];
  const phoff = Number(elf.readBigUInt64LE(0x20)), size = elf.readUInt16LE(0x36), count = elf.readUInt16LE(0x38);
  const aligns = [];
  for (let k = 0; k < count; k++) {
    const at = phoff + k * size;
    if (elf.readUInt32LE(at) === 1) aligns.push(Number(elf.readBigUInt64LE(at + 48)));
  }
  return aligns;
}

function checkEntries(entries, prefix, label) {
  const libs = [...entries.keys()].filter(n => n.startsWith(`${prefix}lib/`) && n.endsWith('.so'));
  const abis = [...new Set(libs.map(n => n.slice(prefix.length).split('/')[1]))].sort();
  report(abis.includes('arm64-v8a') ? 'PASS' : 'FAIL', `${label}: 64-bit ARM native code`, abis.join(', '));
  const unaligned = libs.filter(n => /\/(arm64-v8a|x86_64)\//.test(n))
    .filter(n => loadAlignments(entries.get(n).read()).some(a => a < 16384)).map(n => n.split('/').pop());
  report(unaligned.length ? 'FAIL' : 'PASS', `${label}: 64-bit libraries are 16 KB page aligned (ELF LOAD segments)`,
    unaligned.length ? [...new Set(unaligned)].join(', ') : `${libs.length} libraries checked`);
  const bundle = entries.get(`${prefix}assets/index.android.bundle`);
  const hermes = bundle && bundle.read().subarray(0, 8).equals(Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]));
  report(hermes ? 'PASS' : 'FAIL', `${label}: JavaScript is an embedded, precompiled Hermes bundle`, bundle ? (hermes ? 'Hermes bytecode' : 'plain JavaScript') : 'missing');
  const maps = [...entries.keys()].filter(n => n.endsWith('.map'));
  report(maps.length ? 'FAIL' : 'PASS', `${label}: no source maps shipped`, maps.slice(0, 5).join(', '));
}

function checkManifest(label, { packageName, versionCode, versionName, minSdk, targetSdk, debuggable, permissions, keepsOrientation, gameCategory }) {
  report('INFO', `${label}: package / version`, `${packageName} ${versionName} (versionCode ${versionCode}), minSdk ${minSdk}`);
  report(packageName === 'com.lightkeeper.mirrormaze' ? 'PASS' : 'FAIL', `${label}: application id`, packageName);
  report(Number(targetSdk) >= MIN_TARGET_SDK ? 'PASS' : 'FAIL', `${label}: targetSdk ≥ ${MIN_TARGET_SDK}`, String(targetSdk));
  report(debuggable ? 'FAIL' : 'PASS', `${label}: not debuggable`);
  const unexpected = permissions.filter(p => !EXPECTED_PERMISSIONS.has(p));
  report(unexpected.length ? 'FAIL' : 'PASS', `${label}: only the expected permissions`, unexpected.join(', ') || permissions.length + ' declared');
  report(keepsOrientation || Number(targetSdk) >= 37 ? (Number(targetSdk) >= 37 ? 'WARN' : 'PASS') : 'FAIL',
    `${label}: portrait lock kept on large screens (Android 16, PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY)`,
    Number(targetSdk) >= 37 ? 'the opt-out is ignored from targetSdk 37: decide on appCategory="game" or a large-screen layout' : keepsOrientation ? '' : 'missing');
  // Declaring the app a game opts it into Android's game default frame rate (60 fps on many 120 Hz phones).
  report(gameCategory ? 'WARN' : 'PASS', `${label}: not declared android:appCategory="game"`, gameCategory ? 'game default frame rate applies' : '');
}

/** What an APK's manifest declares, read with aapt2. */
function apkManifest(path) {
  const badging = run(tool('aapt2'), ['dump', 'badging', path]);
  const tree = run(tool('aapt2'), ['dump', 'xmltree', '--file', 'AndroidManifest.xml', path]);
  const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(badging) ?? [];
  return {
    packageName: pkg[1], versionCode: pkg[2], versionName: pkg[3],
    minSdk: /minSdkVersion:'(\d+)'/.exec(badging)?.[1], targetSdk: /targetSdkVersion:'(\d+)'/.exec(badging)?.[1],
    debuggable: /application-debuggable/.test(badging),
    permissions: [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map(m => m[1]),
    keepsOrientation: /PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY/.test(tree),
    // appCategory "game" is the enum value 0.
    gameCategory: /:appCategory\(0x[0-9a-f]+\)=(?:\(type 0x10\))?0(?:x0)?\b/.test(tree),
  };
}

function checkApk(path) {
  const label = path.split(/[\\/]/).pop();
  checkManifest(label, apkManifest(path));
  const certs = apksigner(['verify', '--print-certs', '-v', path]);
  const dn = /Signer #1 certificate DN: (.+)/.exec(certs)?.[1] ?? 'unsigned';
  report(/Verified using v2 scheme.*true/.test(certs) ? 'PASS' : 'FAIL', `${label}: APK signature scheme v2+ verifies`);
  report(/Android Debug/.test(dn) ? 'WARN' : 'PASS', `${label}: signer`, `${dn}${/Android Debug/.test(dn) ? ' (debug key: fine to sideload, never for Play)' : ''}`);
  try {
    run(tool('zipalign'), ['-c', '-P', '16', '-v', '4', path]);
    report('PASS', `${label}: zipalign -P 16 (uncompressed libraries on 16 KB boundaries)`);
  } catch (e) {
    report('FAIL', `${label}: zipalign -P 16`, String(e.stdout ?? e).split('\n').filter(l => /BAD|fail/i.test(l)).slice(0, 3).join(' | '));
  }
  checkEntries(zipEntries(readFileSync(path)), '', label);
}

function checkAab(path) {
  const label = path.split(/[\\/]/).pop();
  const entries = zipEntries(readFileSync(path));
  const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool') : 'keytool';
  const owner = /Owner: (.+)/.exec(run(keytool, ['-printcert', '-jarfile', path]))?.[1] ?? 'unsigned';
  report(owner === 'unsigned' || /Android Debug/.test(owner) ? 'FAIL' : 'PASS', `${label}: signed with the upload key`,
    owner === 'unsigned' ? 'unsigned' : `${owner}${/Android Debug/.test(owner) ? ': Play Console rejects debug-signed bundles' : ''}`);
  checkEntries(entries, 'base/', label);
  const bundletool = process.env.BUNDLETOOL;
  if (!bundletool || !existsSync(bundletool)) { report('WARN', `${label}: manifest not checked`, 'set BUNDLETOOL to bundletool-all.jar'); return; }
  const config = run('java', ['-jar', bundletool, 'dump', 'config', `--bundle=${path}`]);
  report(/PAGE_ALIGNMENT_16K/.test(config) ? 'PASS' : 'WARN', `${label}: bundle asks for 16 KB zip alignment`, /PAGE_ALIGNMENT_\w+/.exec(config)?.[0] ?? 'not set');
  // The universal APK is exactly what the bundle produces for a device; its manifest is checked like a built APK.
  const dir = mkdtempSync(join(tmpdir(), 'mm-release-'));
  try {
    const apks = join(dir, 'universal.apks');
    run('java', ['-jar', bundletool, 'build-apks', `--bundle=${path}`, `--output=${apks}`, '--mode=universal']);
    const apk = join(dir, 'universal.apk');
    writeFileSync(apk, zipEntries(readFileSync(apks)).get('universal.apk').read());
    checkManifest(`${label} (universal APK)`, apkManifest(apk));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

checkSource();
for (const artifact of process.argv.slice(2)) {
  if (!existsSync(artifact)) { report('FAIL', artifact, 'file not found'); continue; }
  const sha = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  report('INFO', `${artifact.split(/[\\/]/).pop()}: SHA-256`, sha);
  try {
    if (artifact.endsWith('.aab')) checkAab(artifact); else checkApk(artifact);
  } catch (e) {
    report('FAIL', artifact, `could not be inspected: ${String(e.message ?? e).split('\n')[0]}`);
  }
}
const width = Math.max(...results.map(r => r.item.length));
for (const r of results) console.log(`${r.status.padEnd(5)} ${r.item.padEnd(width)}  ${r.detail}`);
const failed = results.filter(r => r.status === 'FAIL').length;
console.log(`\n${failed ? `${failed} FAIL` : 'No FAIL'}, ${results.filter(r => r.status === 'WARN').length} WARN`);
process.exit(failed ? 1 : 0);
