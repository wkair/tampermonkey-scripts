import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Premium Double-Page Comic Viewer',
        namespace: 'http://tampermonkey.net/',
        version: '1.3.2',
        updateURL: 'https://raw.githubusercontent.com/wkair/tampermonkey-scripts/main/packages/comic-viewer/dist/comic-viewer.user.js',
        downloadURL: 'https://raw.githubusercontent.com/wkair/tampermonkey-scripts/main/packages/comic-viewer/dist/comic-viewer.user.js',
        description: '세로 스크롤 만화를 가로 2페이지 양면 뷰어(RTL 지원, 표지 단독 보기, 가로 이미지 감지, 자동 다음화 이동)로 최적화합니다.',
        author: 'Antigravity',
        match: [
          '*://update.spotv24.com/*',
          '*://*.spotv24.com/*',
          '*://*.spotv30.com/*',
          '*://*.spotv33.com/*',
          '*://*.spotv34.com/*'
        ],
        grant: [
          'GM_setValue',
          'GM_getValue',
          'GM_registerMenuCommand'
        ],
        'run-at': 'document-end'
      },
      build: {
        fileName: 'comic-viewer.user.js',
      }
    }),
  ],
});
