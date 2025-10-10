#!/usr/bin/env node
// Generate consolidated .env file for DevContainer from host environment variables
// This script captures all HEY_JARVIS_* environment variables from the host system

const fs = require('fs');
const path = require('path');

console.log('Generating consolidated .env file for DevContainer...');

// Root directory of the repository
const rootDir = path.resolve(__dirname, '..');
const envFile = path.join(rootDir, '.env');

// Remove existing .env file if it exists
if (fs.existsSync(envFile)) {
    fs.unlinkSync(envFile);
}

// Create header comment
let envContent = `# Auto-generated DevContainer environment file
# This file captures all HEY_JARVIS_* environment variables from the host system
# DO NOT EDIT MANUALLY - regenerated on DevContainer creation
`;

// Get all environment variables that start with HEY_JARVIS_
const heyJarvisVars = Object.entries(process.env)
    .filter(([key]) => key.startsWith('HEY_JARVIS_'));

if (heyJarvisVars.length > 0) {
    envContent += '\n# HEY_JARVIS_* environment variables from host system\n';
    heyJarvisVars.forEach(([key, value]) => {
        envContent += `${key}=${value}\n`;
    });
    
    console.log(`Successfully captured ${heyJarvisVars.length} HEY_JARVIS_* environment variables from host`);
} else {
    envContent += '\n# No HEY_JARVIS_* environment variables found in host environment\n';
    console.log('Warning: No HEY_JARVIS_* environment variables found in host environment');
}

// Always create the .env file, even if empty, to avoid Docker errors
fs.writeFileSync(envFile, envContent, 'utf8');

console.log('DevContainer .env generation complete.');
