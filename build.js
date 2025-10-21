// build.js - Bundle everything into a single HTML file
import fs from 'fs';
import path from 'path';
import { minify } from 'html-minifier-terser';

console.log('Building single-file game...');

// Read source files
const html = fs.readFileSync('src/index.html', 'utf8');
const css = fs.readFileSync('src/styles.css', 'utf8');
const js = fs.readFileSync('src/game.js', 'utf8');

// Inline CSS and JS into HTML
let output = html.replace('/* CSS_PLACEHOLDER */', css);
output = output.replace('/* JS_PLACEHOLDER */', js);

// Optionally minify (you can disable this for debugging)
const minified = await minify(output, {
  collapseWhitespace: false, // Keep readable for now
  removeComments: false,
  minifyCSS: false,
  minifyJS: false
});

// Write output
fs.writeFileSync('index.html', minified);

console.log('✓ Built index.html');
console.log(`  Size: ${(minified.length / 1024).toFixed(2)} KB`);
console.log('\nNext steps:');
console.log('  1. Generate SSL certificate: make cert');
console.log('  2. Start server: npm run serve');
console.log('  3. Open https://<your-ip>:8443 in Firefox');
