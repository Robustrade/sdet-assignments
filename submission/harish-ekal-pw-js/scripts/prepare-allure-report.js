#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const reportDir = path.join(__dirname, '..', 'allure-report');
const backupDir = path.join(__dirname, '..', 'allure-report-backup');

console.log('Checking for previous allure-report at:', reportDir);

// If current report exists, backup it
if (fs.existsSync(reportDir)) {
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    console.log('✓ Cleared old backup');
  }
  fs.renameSync(reportDir, backupDir);
  console.log('✓ Previous report backed up to allure-report-backup');
} else {
  console.log('ℹ No previous report found, creating new one');
}
