import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ADAPTER_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'adapters',
);

function hostnameMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export async function listSiteAdapters(adapterDir = DEFAULT_ADAPTER_DIR) {
  const entries = await fs.readdir(adapterDir, { withFileTypes: true });
  const adapters = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(adapterDir, entry.name);
    const adapter = JSON.parse(await fs.readFile(file, 'utf8'));
    adapter.adapterFile = file;
    adapters.push(adapter);
  }
  return adapters;
}

export async function loadSiteAdapter(url, options = {}) {
  const parsed = new URL(url);
  const adapters = await listSiteAdapters(options.adapterDir);
  const matches = adapters.filter((adapter) => hostnameMatches(parsed.hostname, adapter.domain));
  if (!matches.length) return null;
  return matches.sort((left, right) => right.domain.length - left.domain.length)[0];
}

export async function verifyAdapterFingerprint(page, adapter) {
  const fingerprints = adapter.fingerprints || [];
  if (!fingerprints.length) return { valid: true, checks: [] };
  const checks = await page.evaluate((rules) => rules.map((rule) => {
    const count = document.querySelectorAll(rule.selector).length;
    const minimum = rule.minCount ?? 1;
    return { selector: rule.selector, count, minimum, valid: count >= minimum };
  }), fingerprints);
  return { valid: checks.every((check) => check.valid), checks };
}

export { DEFAULT_ADAPTER_DIR };
