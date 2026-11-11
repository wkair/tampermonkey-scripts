# Tampermonkey Userscripts

Tampermonkey 유저스크립트를 관리하는 npm workspaces 저장소입니다. Node.js 20.19 이상(20.x) 또는 22.12 이상이 필요합니다.

## 폴더 구조

```text
packages/
├── comic-viewer/
│   ├── src/main.js                # 뷰어 소스
│   ├── userscript.json            # 이름·버전·매칭 주소·업데이트 주소
│   ├── vite.config.mjs            # Vite + vite-plugin-monkey 설정
│   ├── dist/comic-viewer.user.js   # 빌드된 설치 파일
│   ├── toki-viewer.test.cjs        # 호환성 테스트
│   ├── build.test.cjs              # 빌드 결과 실행 검증
│   ├── fixtures/                  # 테스트용 페이지 구조
│   ├── README.md                  # 사용·구현 설명
│   └── HANDOFF.md                 # 후속 작업 인계
└── shared/                        # 공통 유틸리티
```

## 개발

저장소 루트에서 의존성을 설치하고 개발 서버를 실행합니다.

```bash
npm ci
npm run dev:comic-viewer
```

터미널에 표시되는 `http://127.0.0.1:5173/`을 열어 개발용 유저스크립트를 Tampermonkey에 설치하세요. 개발 중에는 배포용 뷰어를 끄고 개발 서버를 켜 둡니다. `src/main.js`를 수정한 뒤 대상 만화 페이지를 새로고침해 확인합니다.

## 빌드와 설치

```bash
npm run build:comic-viewer
# 전체 워크스페이스 빌드
npm run build:all
```

결과물은 `packages/comic-viewer/dist/comic-viewer.user.js`입니다. [설치 파일](https://raw.githubusercontent.com/wkair/tampermonkey-scripts/main/packages/comic-viewer/dist/comic-viewer.user.js)을 열어 Tampermonkey에 설치하거나 파일 전체를 기존 스크립트에 붙여 넣고 저장하세요. 업데이트 주소도 이 배포 파일을 가리킵니다.

코드는 `src/main.js`, 유저스크립트 메타데이터는 `userscript.json`에서 수정합니다. 배포할 때는 `userscript.json`의 버전과 소스의 `VERSION`을 함께 올리고 다시 빌드한 뒤 소스와 `dist` 결과물을 함께 커밋합니다.

## 검증

```bash
npm test
npm run test:build --workspace=packages/comic-viewer
```

호환성 테스트와 빌드된 설치 파일의 메타데이터·실행을 검사합니다. jsdom을 사용하며 실제 브라우저 렌더링이나 이미지 다운로드를 검증하지 않습니다. 사용법은 [뷰어 README](packages/comic-viewer/README.md), 후속 작업은 [작업 인계](packages/comic-viewer/HANDOFF.md)를 참고하세요.
