#!/usr/bin/env node
// CLI backup: node backup.js  (or: npm run backup)
// Copies vault + repo to /Volumes/Seagate/graph-diary-backups/<timestamp>/

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');

const VAULT = path.join(os.homedir(), 'Library', 'Application Support', 'graph-diary', 'vault');
const REPO_ROOT = __dirname;
const BACKUP_DRIVE = '/Volumes/Seagate';
const BACKUP_ROOT = path.join(BACKUP_DRIVE, 'graph-diary-backups');

function countFilesSync(dir) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) count += countFilesSync(path.join(dir, e.name));
      else count++;
    }
  } catch { /* skip unreadable */ }
  return count;
}

async function main() {
  if (!fs.existsSync(BACKUP_DRIVE)) {
    console.error('Error: drive not connected at', BACKUP_DRIVE);
    process.exit(1);
  }
  if (!fs.existsSync(VAULT)) {
    console.error('Error: vault not found at', VAULT);
    process.exit(1);
  }

  const stamp = new Date().toISOString()
    .slice(0, 19).replace('T', '-').replace(/:/g, '');
  const snapshotDir = path.join(BACKUP_ROOT, stamp);
  const vaultDest = path.join(snapshotDir, 'vault');
  const repoDest = path.join(snapshotDir, 'repo');

  console.log('Creating backup at', snapshotDir);
  await fsp.mkdir(vaultDest, { recursive: true });
  await fsp.mkdir(repoDest, { recursive: true });

  console.log('Copying vault…');
  await fsp.cp(VAULT, vaultDest, { recursive: true });

  console.log('Copying repo…');
  await fsp.cp(REPO_ROOT, repoDest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(REPO_ROOT, src);
      return !rel.startsWith('node_modules') && path.basename(src) !== '.DS_Store';
    },
  });

  console.log('Verifying…');
  const srcCount = countFilesSync(VAULT);
  const dstCount = countFilesSync(vaultDest);
  if (srcCount !== dstCount) {
    console.error(`✗ Verification failed: source ${srcCount} files, backup ${dstCount} files`);
    process.exit(1);
  }

  console.log(`✓ Backup complete: ${srcCount} vault files`);
  console.log(`  Snapshot: ${snapshotDir}`);
}

main().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
