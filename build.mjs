import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');

// Build the plugin code (runs in Figma sandbox)
const codeConfig = {
  entryPoints: ['src/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es2017',
  format: 'iife',
  logLevel: 'info',
};

// Build the UI code (runs in iframe)
const uiConfig = {
  entryPoints: ['src/ui.ts'],
  bundle: true,
  outfile: 'dist/ui-bundle.js',
  target: 'es2020',
  format: 'iife',
  logLevel: 'info',
};

// Inline JS into HTML
function buildHtml() {
  const html = fs.readFileSync('src/ui.html', 'utf8');
  let js = '';
  try {
    js = fs.readFileSync('dist/ui-bundle.js', 'utf8');
  } catch (e) {
    // First build, JS not ready yet
  }
  const output = html.replace('<!-- SCRIPT_PLACEHOLDER -->', `<script>${js}</script>`);
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('dist/ui.html', output);
  console.log('  dist/ui.html built');
}

async function build() {
  fs.mkdirSync('dist', { recursive: true });

  if (isWatch) {
    const codeCtx = await esbuild.context(codeConfig);
    const uiCtx = await esbuild.context({
      ...uiConfig,
      plugins: [{
        name: 'html-rebuild',
        setup(build) {
          build.onEnd(() => buildHtml());
        }
      }]
    });
    await codeCtx.watch();
    await uiCtx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(codeConfig);
    await esbuild.build(uiConfig);
    buildHtml();
    console.log('Build complete!');
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
