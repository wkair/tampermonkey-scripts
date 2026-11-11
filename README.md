# Tampermonkey Userscripts

Tampermonkey 유저스크립트를 관리하는 npm workspaces 저장소입니다.

## 폴더 구조

```text
packages/
├── comic-viewer/
│   ├── toki-viewer-fixed.user.js  # 설치할 단일 유저스크립트
│   ├── toki-viewer.test.cjs       # jsdom 기반 호환성 테스트
│   ├── fixtures/                 # 테스트용 페이지 구조
│   ├── package.json
│   ├── package-lock.json
│   ├── README.md                 # 설치·사용·구현 설명
│   └── HANDOFF.md                # 후속 개발을 위한 작업 인계
└── shared/                      # 공통 유틸리티
```

## 설치와 사용

[토끼 뷰어 설치 파일](https://raw.githubusercontent.com/wkair/tampermonkey-scripts/main/packages/comic-viewer/toki-viewer-fixed.user.js)을 열어 Tampermonkey에 설치하거나 파일 전체를 기존 스크립트에 붙여 넣고 저장하세요. 이전 뷰어가 함께 실행 중이면 꺼서 중복 실행을 피합니다.

`packages/comic-viewer/toki-viewer-fixed.user.js` 자체가 설치 파일이며 별도 빌드가 필요하지 않습니다. 사용법과 검증 범위는 [뷰어 README](packages/comic-viewer/README.md), 후속 작업 내용은 [작업 인계](packages/comic-viewer/HANDOFF.md)를 참고하세요.

## 개발과 검증

저장소 루트에서 실행합니다.

```bash
npm ci
npm test
```

뷰어 테스트만 실행할 수도 있습니다.

```bash
npm run test:comic-viewer
```

뷰어 파일을 직접 수정하고 테스트한 뒤 커밋합니다. 테스트는 jsdom을 사용하며 실제 브라우저 렌더링이나 이미지 다운로드를 검증하지 않습니다.
