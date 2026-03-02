const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');


try {
  // Clean and build
  execSync('next build', { stdio: 'inherit' });
  
  // Copy static assets to standalone build
  const staticSrc = '.next/static';
  const staticDest = '.next/standalone/.next/static';
  
  if (fs.existsSync(staticSrc)) {
    fs.copySync(staticSrc, staticDest);
  }
  
  // Copy public folder
  const publicSrc = 'public';
  const publicDest = '.next/standalone/public';
  
  if (fs.existsSync(publicSrc)) {
    fs.copySync(publicSrc, publicDest);
  }
  
  
} catch (error) {
  process.exit(1);
}