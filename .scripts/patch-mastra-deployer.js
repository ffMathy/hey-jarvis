#!/usr/bin/env node
/**
 * Patches the nested @mastra/server in @mastra/deployer to fix export compatibility issues.
 *
 * The mastra CLI's deployer dependency has a nested @mastra/server@1.0.3 which is missing
 * exports for server-adapter, auth, and a2a that the newer versions have.
 *
 * This script copies the missing directories and updates package.json exports.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const newServerDir = path.join(rootDir, 'node_modules', '@mastra', 'server');
const nestedServerDir = path.join(rootDir, 'node_modules', '@mastra', 'deployer', 'node_modules', '@mastra', 'server');

// Check if nested server exists
if (!fs.existsSync(nestedServerDir)) {
  console.log('✅ No nested @mastra/server found in deployer - no patching needed');
  process.exit(0);
}

// Check if new server exists
if (!fs.existsSync(newServerDir)) {
  console.error('❌ Could not find @mastra/server in node_modules');
  process.exit(1);
}

console.log('🔧 Patching nested @mastra/server in @mastra/deployer...');

// Copy entire dist directory to ensure all chunks and dependencies are present
const sourceDistDir = path.join(newServerDir, 'dist');
const targetDistDir = path.join(nestedServerDir, 'dist');

if (fs.existsSync(targetDistDir)) {
  fs.rmSync(targetDistDir, { recursive: true, force: true });
}

fs.cpSync(sourceDistDir, targetDistDir, { recursive: true });
console.log('  ✓ Copied entire dist directory');

// Update package.json exports
const newPkgPath = path.join(newServerDir, 'package.json');
const nestedPkgPath = path.join(nestedServerDir, 'package.json');

const newPkg = JSON.parse(fs.readFileSync(newPkgPath, 'utf8'));
const nestedPkg = JSON.parse(fs.readFileSync(nestedPkgPath, 'utf8'));

// Copy exports from new to nested
nestedPkg.exports = newPkg.exports;

fs.writeFileSync(nestedPkgPath, JSON.stringify(nestedPkg, null, 2));
console.log('  ✓ Updated package.json exports');

console.log('✅ Successfully patched nested @mastra/server');
