#!/usr/bin/env node
// node's OpenSSL/zlib export keep, derived in the toolchain image.
// Inputs: the openssl recipe's tarball .num files; staged zlib.h, archives.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RECIPE = join(HERE, 'APKBUILD');
const OPENSSL_RECIPE = join(REPO, 'ports/main/openssl/APKBUILD');
const SRCDEST = join(REPO, 'ports/cache');
const BEGIN = '\t# visorjs-dep-abi: begin (generated, see visorjs-dep-abi.mjs)';
const END = '\t# visorjs-dep-abi: end';
const ARCHIVE_SELF = new Set(['libcrypto.a', 'libssl.a', 'libz.a']);

function recipeVar(text, name) {
  const m = text.match(new RegExp(`^${name}=(.*)$`, 'm'));
  if (!m) throw new Error(`no ${name}= in recipe`);
  return m[1].replace(/^"|"$/g, '');
}

async function opensslTarball() {
  const text = readFileSync(OPENSSL_RECIPE, 'utf8');
  const pkgver = recipeVar(text, 'pkgver');
  const file = `openssl-${pkgver}.tar.gz`;
  const sums = text.match(/sha512sums="([\s\S]*?)"/);
  const line = sums && sums[1].split('\n').find((l) => l.endsWith(file));
  if (!line) throw new Error(`no sha512 for ${file} in openssl recipe`);
  const want = line.split(/\s+/)[0];
  const path = join(SRCDEST, file);
  if (!existsSync(path)) {
    const url =
      'https://github.com/openssl/openssl/releases/download/' +
      `openssl-${pkgver}/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetching ${url}: ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  const got = createHash('sha512').update(readFileSync(path)).digest('hex');
  if (got !== want) throw new Error(`${path}: sha512 mismatch`);
  return { path, top: `openssl-${pkgver}` };
}

function numNames(tarball, top, member) {
  const text = execFileSync(
    'tar',
    ['-xzOf', tarball, `${top}/util/${member}`],
    { encoding: 'utf8', maxBuffer: 1 << 28 }
  );
  const out = new Set();
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length >= 4 && /(^|:)EXIST(:|$)/.test(f[3])) out.add(f[0]);
  }
  return out;
}

function stagePackages() {
  const text = readFileSync(RECIPE, 'utf8');
  const m = text.match(
    /--repository "\$REPODEST\/main" \\\n([\s\S]*?)\|\| die "staging/
  );
  if (!m) throw new Error('no _stage_deps apk add list in nodejs recipe');
  return m[1].replace(/\\\n/g, ' ').trim().split(/\s+/);
}

function stage() {
  const root = mkdtempSync('/tmp/visorjs-dep-abi.');
  execFileSync(
    'apk',
    [
      'add',
      '--root',
      root,
      '--initdb',
      '--no-scripts',
      '--arch',
      'wasm64',
      '--keys-dir',
      join(REPO, 'ports/keys'),
      '--repository',
      join(REPO, 'ports/repo/main'),
      ...stagePackages(),
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
  return root;
}

function definedGlobals(archive) {
  const text = execFileSync(
    'llvm-nm-21',
    ['--defined-only', '--extern-only', archive],
    {
      encoding: 'utf8',
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  );
  const out = new Set();
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length === 3) out.add(f[2]);
  }
  return out;
}

function zlibFunctions(header) {
  const re = /ZEXTERN\s+[^;]*?\bZEXPORT(?:VA)?\s+(\w+)\s*\(/g;
  const out = new Set();
  for (const m of readFileSync(header, 'utf8').matchAll(re)) out.add(m[1]);
  return out;
}

// True when any name in the sorted list starts with prefix.
function anyStartsWith(sorted, prefix) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo].startsWith(prefix);
}

function groupAbi(names, foreignSorted) {
  const prefixes = [];
  const extras = [];
  const split = (set, depth) => {
    const groups = new Map();
    for (const n of set) {
      const parts = n.match(/[^_]+_?/g) || [];
      if (parts.length <= depth || !parts[depth - 1].endsWith('_')) {
        extras.push(n);
        continue;
      }
      const key = parts.slice(0, depth).join('');
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(n);
    }
    for (const [key, members] of groups) {
      if (members.size < 3) extras.push(...members);
      else if (!anyStartsWith(foreignSorted, key)) prefixes.push(key);
      else split(members, depth + 1);
    }
  };
  split(names, 1);
  return { prefixes: prefixes.sort(), extras: extras.sort() };
}

async function derive() {
  const { path, top } = await opensslTarball();
  const num = new Set([
    ...numNames(path, top, 'libcrypto.num'),
    ...numNames(path, top, 'libssl.num'),
  ]);
  const root = stage();
  try {
    const lib = join(root, 'usr/lib');
    const ssl = new Set([
      ...definedGlobals(join(lib, 'libcrypto.a')),
      ...definedGlobals(join(lib, 'libssl.a')),
    ]);
    const z = definedGlobals(join(lib, 'libz.a'));
    const others = new Set();
    for (const a of readdirSync(lib)) {
      if (!a.endsWith('.a') || ARCHIVE_SELF.has(a)) continue;
      for (const n of definedGlobals(join(lib, a))) others.add(n);
    }
    const foreign = new Set([...ssl].filter((n) => !num.has(n)));
    for (const n of others) foreign.add(n);
    for (const n of z) foreign.add(n);
    const abi = new Set([...num].filter((n) => ssl.has(n)));
    const { prefixes, extras } = groupAbi(abi, [...foreign].sort());
    const over = [...ssl, ...foreign].filter(
      (n) => !abi.has(n) && prefixes.some((p) => n.startsWith(p))
    );
    if (over.length) throw new Error(`prefixes cover non-ABI: ${over[0]}`);
    const zh = zlibFunctions(join(root, 'usr/include/zlib.h'));
    const zlib = [...zh].filter((n) => z.has(n)).sort();
    // A zlib export another archive also defines would export that copy too.
    const clash = zlib.filter((n) => others.has(n) || ssl.has(n));
    if (clash.length) throw new Error(`zlib name defined elsewhere: ${clash}`);
    return { prefixes, extras, zlib, ssl, z, abi, zh };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function wrap(words) {
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > 66) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => `\t\t${l}`).join(' \\\n');
}

function loop(comment, flag, words) {
  return (
    `\t# ${comment}\n\tfor _e in \\\n${wrap(words)}; do\n` +
    `\t\tLDFLAGS="$LDFLAGS --${flag}=$_e"\n\tdone\n`
  );
}

function render({ prefixes, extras, zlib }) {
  return (
    `${BEGIN}\n` +
    loop('OpenSSL .num families.', 'export-prefix', prefixes) +
    loop(
      'OpenSSL .num names no family prefix covers.',
      'export-extra',
      extras
    ) +
    loop("zlib.h's ZEXTERN functions.", 'export-extra', zlib) +
    `${END}\n`
  );
}

function recipeBlock(text) {
  const b = text.indexOf(`${BEGIN}\n`);
  const e = text.indexOf(`${END}\n`);
  if (b < 0 || e < b) throw new Error('no visorjs-dep-abi block in recipe');
  return { b, e: e + END.length + 1 };
}

function wasmExports(file) {
  const b = readFileSync(file);
  let p = 8;
  const u = () => {
    let v = 0;
    let s = 0;
    let x;
    do {
      x = b[p++];
      v += (x & 127) * 2 ** s;
      s += 7;
    } while (x & 128);
    return v;
  };
  const out = new Set();
  while (p < b.length) {
    const id = b[p++];
    const size = u();
    const end = p + size;
    if (id === 7) {
      const n = u();
      for (let i = 0; i < n; i++) {
        const len = u();
        out.add(b.toString('utf8', p, p + len));
        p += len + 1;
        u();
      }
    }
    p = end;
  }
  return out;
}

async function main(argv) {
  const mode = argv[0];
  const d = await derive();
  const text = readFileSync(RECIPE, 'utf8');
  const { b, e } = recipeBlock(text);
  if (mode === '--write') {
    writeFileSync(RECIPE, text.slice(0, b) + render(d) + text.slice(e));
    return 0;
  }
  if (mode === '--check') {
    if (text.slice(b, e) === render(d)) return 0;
    console.error('visorjs-dep-abi: nodejs APKBUILD export keep is stale;');
    console.error('  run: node ports/main/nodejs/visorjs-dep-abi.mjs --write');
    return 1;
  }
  if (mode === '--check-binary') {
    const exported = wasmExports(argv[1]);
    const want = new Set([...d.abi, ...d.zlib]);
    const lib = new Set([...d.ssl, ...d.z]);
    const extra = [...exported].filter((n) => lib.has(n) && !want.has(n));
    const missing = [...want].filter((n) => !exported.has(n));
    if (!extra.length && !missing.length) return 0;
    console.error(`visorjs-dep-abi: ${argv[1]} exports beyond the ABI:`);
    console.error(`  ${extra.slice(0, 20).join(' ')}`);
    console.error(`  and lacks: ${missing.slice(0, 20).join(' ')}`);
    return 1;
  }
  console.error('usage: visorjs-dep-abi.mjs --check|--write|--check-binary F');
  return 2;
}

process.exit(await main(process.argv.slice(2)));
