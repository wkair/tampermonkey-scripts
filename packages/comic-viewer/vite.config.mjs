import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const userscript = JSON.parse(readFileSync(new URL('./userscript.json', import.meta.url), 'utf8'));

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true, open: false },
  build: {
    target: 'es2022',
    minify: false,
    // Terminate the directive before the viewer's immediately invoked function.
    rolldownOptions: { output: { intro: "'use strict';" } },
  },
  plugins: [
    monkey({
      entry: 'src/main.js',
      userscript,
      server: { open: false },
      build: { fileName: 'comic-viewer.user.js' },
    }),
  ],
});
