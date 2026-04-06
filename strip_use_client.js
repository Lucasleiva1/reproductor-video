const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf-8');
      if (content.includes('"use client"') || content.includes("'use client'")) {
        content = content.replace(/^"use client";?\r?\n/gm, '');
        content = content.replace(/^'use client';?\r?\n/gm, '');
        fs.writeFileSync(fullPath, content, 'utf-8');
        console.log('Removed "use client" from', fullPath);
      }
    }
  }
}

processDir(path.join(__dirname, 'src'));
