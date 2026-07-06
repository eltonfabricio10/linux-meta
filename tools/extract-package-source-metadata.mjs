#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const DEFAULT_AUR_META = '/var/lib/pacman/sync/packages-meta-ext-v1.json.gz';

function usage() {
  console.error(`Usage:
  node tools/extract-package-source-metadata.mjs [options]

Options:
  --source pacman|aur|all     Source to extract. Default: all
  --format jsonl|tsv          Output format. Default: jsonl
  --output PATH               Write to file instead of stdout
  --aur-meta PATH             AUR metadata JSON.GZ path
  --names a,b,c               Optional package-name filter
  --limit N                   Optional max rows after filtering

Examples:
  node tools/extract-package-source-metadata.mjs --source all --names firefox,paru --format tsv
  node tools/extract-package-source-metadata.mjs --source pacman --output /tmp/pacman-meta.jsonl
  node tools/extract-package-source-metadata.mjs --source aur --output /tmp/aur-meta.jsonl`);
}

function parseArgs(argv) {
  const args = {
    source: 'all',
    format: 'jsonl',
    output: null,
    aurMeta: DEFAULT_AUR_META,
    names: null,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[i];
    };
    if (a === '--source') args.source = next();
    else if (a === '--format') args.format = next();
    else if (a === '--output') args.output = next();
    else if (a === '--aur-meta') args.aurMeta = next();
    else if (a === '--names') args.names = new Set(next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--limit') args.limit = Number.parseInt(next(), 10);
    else if (a === '-h' || a === '--help') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!['pacman', 'aur', 'all'].includes(args.source)) throw new Error(`Invalid --source: ${args.source}`);
  if (!['jsonl', 'tsv'].includes(args.format)) throw new Error(`Invalid --format: ${args.format}`);
  if (args.limit != null && (!Number.isFinite(args.limit) || args.limit < 1)) throw new Error(`Invalid --limit: ${args.limit}`);
  return args;
}

function run(command, args) {
  const res = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${res.status}:\n${res.stderr}`);
  }
  return res.stdout;
}

function parsePacmanList() {
  const out = run('pacman', ['-Sl']);
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [repo, name, version] = line.split(/\s+/);
      return { repo, name, version };
    });
}

function parseSizeKb(value) {
  if (!value || value === 'None') return null;
  const match = value.replace(',', '.').match(/^([0-9.]+)\s*(B|KiB|MiB|GiB)$/i);
  if (!match) return null;
  const n = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'b') return Math.round(n / 1024);
  if (unit === 'kib') return Math.round(n);
  if (unit === 'mib') return Math.round(n * 1024);
  if (unit === 'gib') return Math.round(n * 1024 * 1024);
  return null;
}

function pushField(record, key, value) {
  if (!key) return;
  if (key === 'Optional Deps') {
    record.optional_deps ??= [];
    if (value && value !== 'None') record.optional_deps.push(value);
  } else if (key === 'Depends On') {
    record.depends = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
  } else if (key === 'Licenses') {
    record.license = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
  } else if (key === 'Groups') {
    record.groups = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
  } else if (key === 'Provides') {
    record.provides = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
  } else if (key === 'Conflicts With') {
    record.conflicts = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
  } else if (key === 'Replaces') {
    record.replaces = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
  } else if (key === 'Installed Size') {
    record.install_size_kb = parseSizeKb(value);
  } else if (key === 'Download Size') {
    record.download_size_kb = parseSizeKb(value);
  } else if (key === 'Repository') {
    record.repo = value;
  } else if (key === 'Name') {
    record.name = value;
    record.source_id = value;
  } else if (key === 'Version') {
    record.version = value;
  } else if (key === 'Description') {
    record.summary = value;
  } else if (key === 'URL') {
    record.url = value === 'None' ? null : value;
  } else if (key === 'Architecture') {
    record.arch = value;
  } else if (key === 'Packager') {
    record.packager = value;
  } else if (key === 'Build Date') {
    record.build_date = value;
  }
}

function parsePacmanInfo(text) {
  const records = [];
  let record = null;
  let lastKey = null;

  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) {
      if (record?.name) records.push(record);
      record = null;
      lastKey = null;
      continue;
    }

    if (!record) record = { source: 'pacman' };

    const field = rawLine.match(/^([^:][^:]+?)\s*:\s*(.*)$/);
    if (field) {
      lastKey = field[1].trim();
      pushField(record, lastKey, field[2].trim());
      continue;
    }

    const continuation = rawLine.match(/^\s+(.+)$/);
    if (continuation && lastKey === 'Optional Deps') {
      pushField(record, lastKey, continuation[1].trim());
    }
  }

  if (record?.name) records.push(record);
  return records;
}

function extractPacman(names, limit) {
  const listed = parsePacmanList();
  const selected = listed
    .filter((p) => !names || names.has(p.name))
    .slice(0, limit ?? undefined);
  const records = [];
  const batchSize = 200;

  for (let i = 0; i < selected.length; i += batchSize) {
    const batch = selected.slice(i, i + batchSize).map((p) => `${p.repo}/${p.name}`);
    const out = run('pacman', ['-Si', ...batch]);
    records.push(...parsePacmanInfo(out));
  }

  return records;
}

function extractAur(path, names, limit) {
  const data = JSON.parse(gunzipSync(readFileSync(path)));
  if (!Array.isArray(data)) throw new Error(`Unexpected AUR metadata shape in ${path}`);

  const records = [];
  for (const item of data) {
    if (!item?.Name) continue;
    if (names && !names.has(item.Name)) continue;
    records.push({
      source: 'aur',
      source_id: item.Name,
      name: item.Name,
      package_base: item.PackageBase ?? null,
      version: item.Version ?? null,
      summary: item.Description ?? null,
      url: item.URL ?? null,
      license: item.License ?? [],
      depends: item.Depends ?? [],
      keywords: item.Keywords ?? [],
      votes: item.NumVotes ?? null,
      popularity: item.Popularity ?? null,
      out_of_date: item.OutOfDate ?? null,
      maintainer: item.Maintainer ?? null,
      submitter: item.Submitter ?? null,
      first_submitted: item.FirstSubmitted ?? null,
      last_modified: item.LastModified ?? null,
      url_path: item.URLPath ?? null,
    });
    if (limit && records.length >= limit) break;
  }
  return records;
}

function tsvCell(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function writeRecords(records, format, output) {
  const stream = output ? createWriteStream(output, { encoding: 'utf8' }) : process.stdout;
  if (format === 'jsonl') {
    for (const r of records) stream.write(`${JSON.stringify(r)}\n`);
  } else {
    const columns = [
      'source', 'repo', 'name', 'version', 'summary', 'url', 'license',
      'depends', 'optional_deps', 'keywords', 'component_hint',
      'launch_hint', 'popularity', 'votes', 'maintainer',
    ];
    stream.write(`${columns.join('\t')}\n`);
    for (const r of records) {
      const row = { ...r };
      row.component_hint = r.source === 'pacman' ? null : 'aur-package';
      row.launch_hint = null;
      stream.write(`${columns.map((c) => tsvCell(row[c])).join('\t')}\n`);
    }
  }
  if (output) stream.end();
}

try {
  const args = parseArgs(process.argv.slice(2));
  const records = [];
  if (args.source === 'pacman' || args.source === 'all') {
    records.push(...extractPacman(args.names, args.limit));
  }
  if (args.source === 'aur' || args.source === 'all') {
    const remaining = args.limit ? Math.max(args.limit - records.length, 0) : null;
    if (remaining !== 0) records.push(...extractAur(args.aurMeta, args.names, remaining));
  }
  writeRecords(records, args.format, args.output);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  usage();
  process.exit(1);
}
