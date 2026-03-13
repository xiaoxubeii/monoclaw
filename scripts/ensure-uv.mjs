#!/usr/bin/env zx

import 'zx/globals';

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');

function getCurrentTarget() {
  const id = `${os.platform()}-${os.arch()}`;
  const binName = os.platform() === 'win32' ? 'uv.exe' : 'uv';
  return { id, binName };
}

async function hasBundledUvForCurrentTarget() {
  const { id, binName } = getCurrentTarget();
  const bundledPath = path.join(OUTPUT_BASE, id, binName);
  return fs.pathExists(bundledPath);
}

async function hasUvInSystemPath() {
  try {
    const result = await $`uv --version`;
    const version = result.stdout.trim();
    echo(chalk.green`✅ Found system uv: ${version}`);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (await hasBundledUvForCurrentTarget()) {
    const { id } = getCurrentTarget();
    echo(chalk.cyan`📦 Bundled uv already exists for ${id}; skipping download.`);
    return;
  }

  if (await hasUvInSystemPath()) {
    echo(chalk.cyan`🎯 Using system uv for local development setup.`);
    echo(chalk.gray`   Tip: run "pnpm run uv:download" when you need bundled binaries for packaging.`);
    return;
  }

  echo(chalk.cyan`⬇️ uv not found in PATH; downloading bundled binaries...`);
  await $`zx ${path.join(__dirname, 'download-bundled-uv.mjs')}`;
}

await main();
