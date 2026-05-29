# Tampermonkey Userscripts Monorepo

템퍼몽키(Tampermonkey) 유저스크립트 관리를 위한 모던 모노레포 개발 및 배포 환경입니다. `npm workspaces`와 `Vite`, `TypeScript`, `vite-plugin-monkey`를 결합하여 구성되었습니다.

---

## 📂 폴더 구조 (Directory Structure)

```text
├── .gitignore                     # Git 추적 예외 파일 설정 (node_modules, dist 등)
├── package.json                   # 루트 워크스페이스 및 통합 스크립트 설정
├── README.md                      # [현재 파일] 개발 및 배포 가이드
└── packages/
    ├── shared/                    # 공통 유틸리티 공간 (스토리지, DOM 헬퍼 등)
    └── comic-viewer/              # 프리미엄 가로 양면 만화 뷰어 유저스크립트
        ├── vite.config.ts         # 빌드 및 템퍼몽키 메타데이터 헤더 설정
        ├── tsconfig.json          # TypeScript 설정
        └── src/
            ├── main.ts            # 메인 소스코드 (TypeScript)
            └── style.css          # 인젝션 전용 스타일시트 (CSS)
```

---

## ⚡️ 개발 방법 (Local Development Guide)

이 모노레포는 **로컬 실시간 핫리로드(Hot Reloading)** 환경을 지원하므로 코드를 저장하는 즉시 브라우저 화면에 실시간으로 반영됩니다.

1. **의존성 모듈 설치** (최초 1회):
   ```bash
   npm install
   ```

2. **개발용 로컬 서버 구동**:
   ```bash
   npm run dev:comic-viewer
   ```
   - 서버가 가동되면 터미널에 `http://127.0.0.1:5173/` 형태의 주소가 나타납니다.

3. **브라우저에 개발용 프록시 스크립트 등록**:
   - 템퍼몽키 확장 프로그램이 활성화된 브라우저로 위의 주소(`http://127.0.0.1:5173/`)에 접속하거나, 해당 주소 뒤에 `comic-viewer.user.js`를 덧붙여 접속합니다.
   - 템퍼몽키 설치 안내 화면이 나타나면 **[설치]**를 클릭합니다. (내부 소스코드 대신 로컬 서버의 빌드를 실시간 중계하는 프록시 스크립트가 등록됩니다.)

4. **실시간 개발**:
   - 이제 타겟 웹사이트(예: 매칭 조건에 해당하는 만화 뷰어 사이트)에 접속합니다.
   - `packages/comic-viewer/src/main.ts` 혹은 `style.css` 파일을 편집기에서 수정 후 저장하면, 브라우저 화면이 **즉시 갱신**되어 개발 결과를 확인할 수 있습니다.

---

## 📦 배포용 파일 빌드 (Production Build)

실제 사용 및 배포를 위한 완전히 정적인 단일 유저스크립트 파일을 컴파일하는 단계입니다.

1. **전체 프로젝트 빌드 실행**:
   ```bash
   npm run build:all
   ```

2. **결과물 확인**:
   - 빌드가 완료되면 다음 경로에 완전히 컴파일 및 스타일시트가 내장된 프로덕션 코드가 저장됩니다.
     `packages/comic-viewer/dist/comic-viewer.user.js`
   - 이 단일 `.user.js` 파일을 다른 컴퓨터에 설치하거나 배포하시면 됩니다.

---

## ☁️ 여러 컴퓨터에서 사용하는 배포 및 동기화 (Multi-Device Auto Update)

깃허브(GitHub) 저장소의 Raw CDN 기능과 템퍼몽키의 자동 업데이트 기능을 엮어 무중단으로 여러 컴퓨터의 스크립트를 항시 최신으로 갱신하는 최선의 방법입니다.

### 1. 깃허브 원격 저장소 추가 및 소스 전송
새로운 깃허브 저장소(예: `comic-viewer-repo`)를 만드신 후, 터미널에서 다음 명령어를 실행하여 업로드합니다.
```bash
git remote add origin https://github.com/사용자이름/레포지토리이름.git
git branch -M main
git push -u origin main
```

### 2. 자동 업데이트 주소 설정
1. 깃허브에 빌드 완료된 `packages/comic-viewer/dist/comic-viewer.user.js` 파일 상세 화면으로 이동합니다.
2. 우측 상단의 **[Raw]** 버튼을 클릭하여 나타나는 원본 소스코드의 웹 주소를 복사합니다.
   * *주소 형태: `https://raw.githubusercontent.com/사용자이름/레포지토리이름/main/packages/comic-viewer/dist/comic-viewer.user.js`*
3. 복사한 Raw 주소를 `packages/comic-viewer/vite.config.ts` 파일의 `userscript` 메타데이터 블록 내에 다음과 같이 기입합니다.
   ```typescript
   userscript: {
     name: 'Premium Double-Page Comic Viewer',
     version: '1.3.2',
     // ...
     updateURL: '복사한_RAW_주소',
     downloadURL: '복사한_RAW_주소',
   }
   ```
4. 코드를 새로 빌드(`npm run build:all`) 후 깃에 변경사항을 `push`합니다.

### 3. 다른 기기 등록
- 다른 모든 컴퓨터의 브라우저에서 복사했던 **Raw 주소로 직접 한 번만 접속**하여 유저스크립트를 새로 설치합니다.
- 이후 메인 컴퓨터에서 소스 수정 후 `version` 헤더의 숫자 값을 소폭 상향 조정(예: `1.3.2` ➔ `1.3.3`)하여 커밋/푸시하면, 다른 컴퓨터 브라우저의 템퍼몽키가 백그라운드에서 이를 감지해 **최신 버전으로 자동 설치 및 패치**합니다.
