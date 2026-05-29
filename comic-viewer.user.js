// ==UserScript==
// @name         Premium Double-Page Comic Viewer
// @namespace    http://tampermonkey.net/
// @version      1.3.2
// @description  세로 스크롤 만화를 가로 2페이지 양면 뷰어(RTL 지원, 표지 단독 보기, 가로 이미지 감지, 자동 다음화 이동)로 최적화합니다.
// @author       Antigravity
// @match        *://update.spotv24.com/*
// @match        *://*.spotv24.com/*
// @match        *://*.spotv30.com/*
// @match        *://*.spotv33.com/*
// @match        *://*.spotv34.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  // --- 0. URL Guard ---
  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has("wr_id")) {
    console.log(
      "[2-Page Comic Viewer] 에피소드 목록/작품 정보 페이지이므로 스크립트 활성화를 건너뜁니다.",
    );
    return;
  }

  const hasViewerFlag = urlParams.get("cv_view") === "true";

  console.log(
    "[2-Page Comic Viewer] 스크립트 v1.3.2 로드됨. 에피소드 페이지 확인 완료.",
  );

  // --- 1. Persistent Storage Helpers ---
  function getStorage(key, defaultValue) {
    if (typeof GM_getValue !== "undefined") {
      return GM_getValue(key, defaultValue);
    }
    const val = localStorage.getItem("cv_" + key);
    return val !== null ? JSON.parse(val) : defaultValue;
  }

  function setStorage(key, value) {
    if (typeof GM_setValue !== "undefined") {
      GM_setValue(key, value);
      return;
    }
    localStorage.setItem("cv_" + key, JSON.stringify(value));
  }

  // URL Resolver using native browser engine
  function resolveUrl(src) {
    if (!src) return "";
    try {
      return new URL(src, window.location.href).href;
    } catch (e) {
      // Manual fallback
      if (src.startsWith("//")) {
        return window.location.protocol + src;
      }
      if (src.startsWith("/")) {
        return window.location.origin + src;
      }
      return src;
    }
  }

  // Safely append cv_view=true query parameter to a URL
  function appendViewerParam(url) {
    if (!url) return url;
    try {
      const parsed = new URL(url, window.location.href);
      parsed.searchParams.set("cv_view", "true");
      return parsed.href;
    } catch (e) {
      const separator = url.includes("?") ? "&" : "?";
      return url + separator + "cv_view=true";
    }
  }

  // --- 2. State Management ---
  const state = {
    isActive: false, // Set to false initially, will set true on successful load
    images: [], // Array of { src, aspect, element }
    spreads: [], // Array of spreads, e.g. [[0], [1, 2], [3, 4]]
    currentSpreadIndex: 0, // Index in state.spreads
    isRTL: getStorage("isRTL", true), // Japanese reading direction (Right to Left)
    coverMode: getStorage("coverMode", true), // Keep the first page single
    nextUrl: null, // URL of the next episode
    prevUrl: null, // URL of the previous episode
    keyEventsBound: false, // Prevent redundant key listener registration
    nextChapterConfirm: false, // Confirm going to the next chapter on double input
    prevChapterConfirm: false, // Confirm going to the prev chapter on double input
    transitionMode: getStorage("transitionMode", "instant"), // Transition style: 'instant' or 'fade'
  };

  // --- 3. Robust Heuristics & Global Variables Engine ---

  // Find all valid cartoon/manga images
  function scrapeImages() {
    const pageWindow =
      typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    let urls = [];

    // PRIMARY: Extract directly from the page's global Javascript variables (spotv24/11toon standard)
    if (
      pageWindow.img_list &&
      Array.isArray(pageWindow.img_list) &&
      pageWindow.img_list.length > 0
    ) {
      urls = pageWindow.img_list;
      console.log(
        `[2-Page Comic Viewer] pageWindow.img_list 감지됨: ${urls.length}장`,
      );
    } else if (
      pageWindow.img_list_2 &&
      Array.isArray(pageWindow.img_list_2) &&
      pageWindow.img_list_2.length > 0
    ) {
      urls = pageWindow.img_list_2;
      console.log(
        `[2-Page Comic Viewer] pageWindow.img_list_2 감지됨: ${urls.length}장`,
      );
    }

    if (urls.length > 0) {
      const uniqueUrls = Array.from(new Set(urls));
      return uniqueUrls.map((url) => ({
        src: resolveUrl(url),
        aspect: 0.7, // Default portrait, will update once loaded
        loaded: false,
      }));
    }

    // FALLBACK: DOM-based scraping (original heuristics)
    const imgElements = Array.from(document.querySelectorAll("img"));
    const candidates = [];

    console.log(
      `[2-Page Comic Viewer] 글로벌 변수가 없어 DOM 스크랩 실행. 총 이미지 개수: ${imgElements.length}`,
    );

    const gnuboardSelectors = [
      "#bo_v_con",
      ".view-content",
      ".bo_v_con",
      "#writeContents",
      ".writeContents",
      "article",
      ".post-content",
      ".view-img",
    ];

    let gnuboardContainer = null;
    for (const selector of gnuboardSelectors) {
      const el = document.querySelector(selector);
      if (el && el.querySelectorAll("img").length >= 2) {
        gnuboardContainer = el;
        console.log(
          `[2-Page Comic Viewer] 그누보드 본문 컨테이너 감지됨: ${selector}`,
        );
        break;
      }
    }

    imgElements.forEach((img) => {
      let src =
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy-src") ||
        img.getAttribute("data-original") ||
        img.getAttribute("data-url") ||
        img.getAttribute("data-srcset") ||
        img.src;

      if (
        !src ||
        src.startsWith("data:image/svg+xml") ||
        src.includes("avatar") ||
        src.includes("profile")
      ) {
        return;
      }

      src = resolveUrl(src);

      const identifier = (
        (img.className || "") +
        " " +
        (img.id || "") +
        " " +
        (img.alt || "")
      ).toLowerCase();
      const blacklist = [
        "logo",
        "icon",
        "banner",
        "ad-",
        "advertisement",
        "widget",
        "thumb",
        "captcha",
        "smile",
        "emoticon",
        "header",
        "footer",
      ];
      if (blacklist.some((term) => identifier.includes(term))) {
        return;
      }

      let parent = img.parentElement;
      let isInBlacklistedContainer = false;
      while (parent) {
        const parentTag = parent.tagName.toLowerCase();
        const parentId = (parent.id || "").toLowerCase();
        const parentClass = (parent.className || "").toLowerCase();
        if (
          ["header", "footer", "nav", "aside"].includes(parentTag) ||
          parentId.includes("comment") ||
          parentClass.includes("comment") ||
          parentId.includes("widget") ||
          parentClass.includes("widget") ||
          parentId.includes("sidebar") ||
          parentClass.includes("sidebar") ||
          parentId.includes("menu") ||
          parentClass.includes("menu")
        ) {
          isInBlacklistedContainer = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (isInBlacklistedContainer) return;

      candidates.push({ element: img, src: src });
    });

    let filteredCandidates = [];

    if (gnuboardContainer) {
      filteredCandidates = candidates.filter((cand) =>
        gnuboardContainer.contains(cand.element),
      );
    }

    if (filteredCandidates.length < 3) {
      const groups = new Map();
      candidates.forEach((cand) => {
        let container = cand.element.parentElement;
        if (container && container.tagName.toLowerCase() === "a") {
          container = container.parentElement;
        }
        if (container) {
          groups.set(container, (groups.get(container) || 0) + 1);
        }
      });

      let maxCount = 0;
      let bestContainer = null;
      for (const [container, count] of groups.entries()) {
        if (count > maxCount) {
          maxCount = count;
          bestContainer = container;
        }
      }

      if (bestContainer && maxCount >= 3) {
        filteredCandidates = candidates.filter((cand) =>
          bestContainer.contains(cand.element),
        );
      }
    }

    if (filteredCandidates.length < 3) {
      filteredCandidates = candidates.filter((cand) => {
        const w = cand.element.naturalWidth || cand.element.width;
        const h = cand.element.naturalHeight || cand.element.height;
        if (w > 0 && h > 0) {
          return w > 300 || h > 300;
        }
        return true;
      });
    }

    const uniqueUrls = new Set();
    const finalImages = [];
    filteredCandidates.forEach((cand) => {
      if (!uniqueUrls.has(cand.src)) {
        uniqueUrls.add(cand.src);
        finalImages.push({
          src: cand.src,
          aspect: 0.7,
          loaded: false,
        });
      }
    });

    return finalImages;
  }

  // Heuristically find next/prev episode links
  function scrapeNavigationLinks() {
    const anchors = Array.from(
      document.querySelectorAll('a, button, [role="button"]'),
    );

    const nextRegex =
      /(다음\s*화|다음\s*편|다음\s*에피소드|다음\s*글|다음\s*화\s*보기|next\s*ep|next\s*chapter|next\s*vol|▶|→)/i;
    const prevRegex =
      /(이전\s*화|이전\s*편|이전\s*에피소드|이전\s*글|이전\s*화\s*보기|prev\s*ep|prev\s*chapter|prev\s*vol|◀|←)/i;

    let nextCandidate = null;
    let prevCandidate = null;

    for (const anchor of anchors) {
      const text = (anchor.textContent || anchor.innerText || "").trim();
      const href = anchor.getAttribute("href") || "";
      const className = (anchor.className || "").toLowerCase();
      const idName = (anchor.id || "").toLowerCase();

      if (!href || href.startsWith("javascript:") || href.startsWith("#")) {
        if (
          nextRegex.test(text) ||
          className.includes("next") ||
          idName.includes("next") ||
          className.includes("btn_nxt")
        ) {
          if (!nextCandidate) nextCandidate = anchor;
        }
        if (
          prevRegex.test(text) ||
          className.includes("prev") ||
          idName.includes("prev") ||
          className.includes("btn_prv")
        ) {
          if (!prevCandidate) prevCandidate = anchor;
        }
        continue;
      }

      const cleanUrl = resolveUrl(href);
      if (cleanUrl === window.location.href) continue;

      if (
        nextRegex.test(text) ||
        className.includes("btn_nxt") ||
        className.includes("next-link")
      ) {
        nextCandidate = cleanUrl;
      }
      if (
        prevRegex.test(text) ||
        className.includes("btn_prv") ||
        className.includes("prev-link")
      ) {
        prevCandidate = cleanUrl;
      }
    }

    // Gnuboard specific navigation selectors backup
    if (!nextCandidate) {
      const nxtEl = document.querySelector(
        ".btn_nxt, .bo_v_nb .btn_next, a.btn_next, .right-episode.next, button.next",
      );
      if (nxtEl) {
        const onclickText = nxtEl.getAttribute("onclick") || "";
        const match = onclickText.match(
          /location\.href\s*=\s*['"]([^'"]+)['"]/,
        );
        if (match) {
          nextCandidate = match[1];
        } else {
          nextCandidate = nxtEl.getAttribute("href");
        }
      }
    }
    if (!prevCandidate) {
      const prvEl = document.querySelector(
        ".btn_prv, .bo_v_nb .btn_prev, a.btn_prev, .left-episode.prev, button.prev",
      );
      if (prvEl) {
        const onclickText = prvEl.getAttribute("onclick") || "";
        const match = onclickText.match(
          /location\.href\s*=\s*['"]([^'"]+)['"]/,
        );
        if (match) {
          prevCandidate = match[1];
        } else {
          prevCandidate = prvEl.getAttribute("href");
        }
      }
    }

    state.nextUrl = nextCandidate ? resolveUrl(nextCandidate) : null;
    state.prevUrl = prevCandidate ? resolveUrl(prevCandidate) : null;

    console.log(
      `[2-Page Comic Viewer] 다음화 링크: ${state.nextUrl || "없음"}, 이전화 링크: ${state.prevUrl || "없음"}`,
    );
  }

  // --- 4. Premium Overlay UI & Styles ---
  let overlayEl = null;
  let viewAreaEl = null;
  let ctrlPanelEl = null;
  let progressBarEl = null;
  let progressIndicatorEl = null;
  let pageNumEl = null;
  let manualLaunchBtn = null; // Tiny floating manual toggle badge

  function injectStyles() {
    if (document.getElementById("premium-comic-viewer-styles")) return;

    const style = document.createElement("style");
    style.id = "premium-comic-viewer-styles";
    style.textContent = `
            :root {
                --cv-bg: #0d0d0d;
                --cv-panel-bg: rgba(18, 18, 18, 0.82);
                --cv-panel-border: rgba(255, 255, 255, 0.08);
                --cv-accent: #3b82f6;
                --cv-accent-glow: rgba(59, 130, 246, 0.35);
                --cv-text: #e2e8f0;
                --cv-text-muted: #94a3b8;
                --cv-panel-blur: blur(16px) saturate(180%);
                --cv-radius: 12px;
                --cv-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            }

            .cv-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background-color: var(--cv-bg);
                z-index: 999999;
                display: none;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                overflow: hidden;
                font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                color: var(--cv-text);
                opacity: 0;
                transition: opacity 0.3s ease;
            }

            .cv-overlay.active {
                display: flex;
                opacity: 1;
            }

            .cv-view-area {
                display: flex;
                width: 100%;
                height: 100vh;
                justify-content: center;
                align-items: center;
                position: relative;
                user-select: none;
            }

            .cv-click-zone {
                position: absolute;
                top: 0;
                height: 100%;
                width: 25%;
                cursor: pointer;
                z-index: 10;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.3s ease;
                background: linear-gradient(to right, rgba(255,255,255,0.01), transparent);
            }
            
            .cv-click-zone.right-zone {
                right: 0;
                background: linear-gradient(to left, rgba(255,255,255,0.01), transparent);
            }

            .cv-click-zone:hover {
                opacity: 0.15;
                background: linear-gradient(to right, rgba(255,255,255,0.05), transparent);
            }
            .cv-click-zone.right-zone:hover {
                background: linear-gradient(to left, rgba(255,255,255,0.05), transparent);
            }

            .cv-spread-container {
                position: absolute;
                top: 0;
                left: 0;
                display: flex;
                height: 100%;
                width: 100%;
                justify-content: center;
                align-items: center;
                gap: 0;
                transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.2s ease;
            }

            .cv-spread-container.rtl {
                flex-direction: row-reverse;
            }

            .cv-page-wrapper {
                flex: 1;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100%;
                max-width: 50%;
                position: relative;
            }

            /* Seamless center seam logic for 2-page spreads */
            .cv-spread-container:not(.rtl) .cv-page-wrapper:first-child {
                justify-content: flex-end;
            }
            .cv-spread-container:not(.rtl) .cv-page-wrapper:last-child {
                justify-content: flex-start;
            }
            .cv-spread-container.rtl .cv-page-wrapper:first-child {
                justify-content: flex-start;
            }
            .cv-spread-container.rtl .cv-page-wrapper:last-child {
                justify-content: flex-end;
            }

            .cv-page-wrapper.single-page {
                max-width: 100%;
                justify-content: center !important;
            }

            .cv-comic-image {
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                border-radius: 0;
                box-shadow: none;
                opacity: 0;
                transition: opacity 0.2s ease;
            }

            .cv-comic-image.loaded {
                opacity: 1;
            }

            .cv-spread-container.instant .cv-comic-image {
                transition: none !important;
            }

            .cv-spinner {
                position: absolute;
                width: 40px;
                height: 40px;
                border: 3px solid rgba(255, 255, 255, 0.1);
                border-radius: 50%;
                border-top-color: var(--cv-accent);
                animation: cv-spin 0.8s linear infinite;
            }

            @keyframes cv-spin {
                to { transform: rotate(360deg); }
            }

            .cv-ctrl-panel {
                position: absolute;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%) translateY(0);
                width: auto;
                min-width: 480px;
                height: 56px;
                background: var(--cv-panel-bg);
                backdrop-filter: var(--cv-panel-blur);
                -webkit-backdrop-filter: var(--cv-panel-blur);
                border: 1px solid var(--cv-panel-border);
                border-radius: 28px;
                box-shadow: var(--cv-shadow);
                display: flex;
                align-items: center;
                padding: 0 24px;
                gap: 18px;
                z-index: 100;
                transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.25, 1, 0.5, 1);
            }

            .cv-ctrl-panel.idle {
                opacity: 0.1;
                transform: translateX(-50%) translateY(12px);
            }

            .cv-ctrl-panel.idle:hover {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }

            .cv-btn {
                background: transparent;
                border: none;
                color: var(--cv-text);
                font-size: 14px;
                font-weight: 500;
                padding: 6px 12px;
                border-radius: 16px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
                user-select: none;
            }

            .cv-btn:hover {
                background: rgba(255, 255, 255, 0.08);
                color: #ffffff;
            }

            .cv-btn.active {
                background: var(--cv-accent);
                color: #ffffff;
                box-shadow: 0 0 10px var(--cv-accent-glow);
            }

            .cv-divider {
                width: 1px;
                height: 20px;
                background: rgba(255, 255, 255, 0.12);
            }

            .cv-page-info {
                font-size: 14px;
                font-weight: 500;
                color: var(--cv-text-muted);
                min-width: 90px;
                text-align: center;
            }

            .cv-slider-container {
                flex: 1;
                height: 6px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
                position: relative;
                cursor: pointer;
                transition: height 0.15s ease;
            }

            .cv-slider-container:hover {
                height: 8px;
            }

            .cv-slider-bar {
                height: 100%;
                width: 0%;
                background: var(--cv-accent);
                border-radius: 3px;
                box-shadow: 0 0 6px var(--cv-accent-glow);
                position: absolute;
                left: 0;
                top: 0;
                transition: width 0.1s linear;
            }

            .cv-slider-tooltip {
                position: absolute;
                bottom: 20px;
                transform: translateX(-50%);
                background: #1e293b;
                border: 1px solid rgba(255,255,255,0.1);
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                color: #ffffff;
                pointer-events: none;
                display: none;
                white-space: nowrap;
                box-shadow: var(--cv-shadow);
            }

            .cv-alert {
                position: fixed;
                top: 30px;
                left: 50%;
                transform: translateX(-50%) translateY(-20px);
                background: rgba(30, 41, 59, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.15);
                backdrop-filter: blur(8px);
                color: #ffffff;
                padding: 10px 24px;
                border-radius: 30px;
                font-size: 14px;
                font-weight: 500;
                box-shadow: var(--cv-shadow);
                opacity: 0;
                z-index: 1000000;
                transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
                pointer-events: none;
            }

            .cv-alert.show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }

            .cv-toggle-btn {
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.05);
            }

            .cv-restore-btn {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 1000000;
                background: rgba(18, 18, 18, 0.6);
                backdrop-filter: blur(10px);
                border: 1px solid var(--cv-panel-border);
                color: var(--cv-text);
                width: 40px;
                height: 40px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                cursor: pointer;
                transition: all 0.2s ease;
                box-shadow: var(--cv-shadow);
            }

            .cv-restore-btn:hover {
                background: rgba(239, 68, 68, 0.8);
                color: white;
                transform: scale(1.1);
            }

            body.cv-active-mode {
                overflow: hidden !important;
            }

            .cv-manual-launcher {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 999998;
                background: rgba(30, 41, 59, 0.75);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #ffffff;
                padding: 10px 16px;
                border-radius: 20px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s ease;
                user-select: none;
            }

            .cv-manual-launcher:hover {
                background: var(--cv-accent);
                transform: scale(1.05);
                box-shadow: 0 0 10px var(--cv-accent-glow);
            }
        `;
    document.head.appendChild(style);
  }

  // Creates manual activation button in the corner
  function createManualLaunchButton() {
    if (manualLaunchBtn) return;

    manualLaunchBtn = document.createElement("div");
    manualLaunchBtn.className = "cv-manual-launcher";
    manualLaunchBtn.innerHTML = "📖 2Page 뷰어";
    manualLaunchBtn.title = "2페이지 가로 양면 뷰어 강제 활성화";
    manualLaunchBtn.addEventListener("click", () => {
      const scraped = scrapeImages();
      if (scraped.length > 0) {
        state.images = scraped;
        console.log(
          `[2-Page Comic Viewer] 수동 활성화: ${state.images.length}장 수집.`,
        );
        scrapeNavigationLinks();
        buildSpreads();
        injectStyles();
        createOverlay();
        toggleViewer(true);
        discoverImageAspectRatios();
      } else {
        alert("페이지에서 분석할 수 있는 만화 이미지를 찾지 못했습니다.");
      }
    });

    document.body.appendChild(manualLaunchBtn);
  }

  function createOverlay() {
    if (overlayEl) return;

    overlayEl = document.createElement("div");
    overlayEl.className = "cv-overlay";

    const restoreBtn = document.createElement("div");
    restoreBtn.className = "cv-restore-btn";
    restoreBtn.innerHTML = "×";
    restoreBtn.title = "뷰어 끄기 (ESC)";
    restoreBtn.addEventListener("click", () => toggleViewer(false));
    overlayEl.appendChild(restoreBtn);

    const leftZone = document.createElement("div");
    leftZone.className = "cv-click-zone left-zone";
    leftZone.addEventListener("click", () => handleZoneClick("left"));
    overlayEl.appendChild(leftZone);

    const rightZone = document.createElement("div");
    rightZone.className = "cv-click-zone right-zone";
    rightZone.addEventListener("click", () => handleZoneClick("right"));
    overlayEl.appendChild(rightZone);

    viewAreaEl = document.createElement("div");
    viewAreaEl.className = "cv-view-area";
    overlayEl.appendChild(viewAreaEl);

    ctrlPanelEl = document.createElement("div");
    ctrlPanelEl.className = "cv-ctrl-panel";

    const prevBtn = document.createElement("button");
    prevBtn.className = "cv-btn";
    prevBtn.innerHTML = "◀";
    prevBtn.title = "이전 페이지";
    prevBtn.addEventListener("click", navigatePrev);
    ctrlPanelEl.appendChild(prevBtn);

    ctrlPanelEl.appendChild(createDivider());

    const directionBtn = document.createElement("button");
    directionBtn.className = `cv-btn cv-toggle-btn ${state.isRTL ? "active" : ""}`;
    directionBtn.id = "cv-dir-btn";
    directionBtn.innerHTML = state.isRTL ? "⇄ ◀" : "⇄ ▶";
    directionBtn.title = state.isRTL
      ? "읽는 방향: 우측에서 좌측 (RTL)"
      : "읽는 방향: 좌측에서 우측 (LTR)";
    directionBtn.addEventListener("click", () => {
      state.isRTL = !state.isRTL;
      setStorage("isRTL", state.isRTL);
      directionBtn.classList.toggle("active", state.isRTL);
      directionBtn.innerHTML = state.isRTL ? "⇄ ◀" : "⇄ ▶";
      directionBtn.title = state.isRTL
        ? "읽는 방향: 우측에서 좌측 (RTL)"
        : "읽는 방향: 좌측에서 우측 (LTR)";
      let prevRTL = state.spreads[state.currentSpreadIndex];
      buildSpreads();
      matchSpreadWithIndex(prevRTL[0]);
      renderView();
      showAlert(
        state.isRTL
          ? "우측에서 좌측으로 읽습니다 (RTL)"
          : "좌측에서 우측으로 읽습니다 (LTR)",
      );
    });
    ctrlPanelEl.appendChild(directionBtn);

    const coverBtn = document.createElement("button");
    coverBtn.className = `cv-btn cv-toggle-btn ${state.coverMode ? "active" : ""}`;
    coverBtn.id = "cv-cover-btn";
    coverBtn.innerHTML = "📔";
    coverBtn.title = state.coverMode
      ? "첫 페이지 단독 표지 모드: 켜짐"
      : "첫 페이지 단독 표지 모드: 꺼짐";
    coverBtn.addEventListener("click", () => {
      state.coverMode = !state.coverMode;
      setStorage("coverMode", state.coverMode);
      coverBtn.classList.toggle("active", state.coverMode);
      coverBtn.title = state.coverMode
        ? "첫 페이지 단독 표지 모드: 켜짐"
        : "첫 페이지 단독 표지 모드: 꺼짐";
      let prevIndex = state.spreads[state.currentSpreadIndex][0];
      buildSpreads();
      matchSpreadWithIndex(prevIndex);
      renderView();
      showAlert(
        state.coverMode
          ? "첫 이미지를 단독 표지로 보여줍니다"
          : "첫 이미지부터 양면으로 보여줍니다",
      );
    });
    ctrlPanelEl.appendChild(coverBtn);

    const transBtn = document.createElement("button");
    transBtn.className = `cv-btn cv-toggle-btn ${state.transitionMode === "fade" ? "active" : ""}`;
    transBtn.id = "cv-trans-btn";
    transBtn.innerHTML = state.transitionMode === "fade" ? "✨" : "⚡";
    transBtn.title =
      state.transitionMode === "fade"
        ? "화면 전환 효과: 크로스페이드 (부드럽게)"
        : "화면 전환 효과: 즉시 변경 (눈 피로 최소화)";
    transBtn.addEventListener("click", () => {
      state.transitionMode =
        state.transitionMode === "fade" ? "instant" : "fade";
      setStorage("transitionMode", state.transitionMode);
      transBtn.classList.toggle("active", state.transitionMode === "fade");
      transBtn.innerHTML = state.transitionMode === "fade" ? "✨" : "⚡";
      transBtn.title =
        state.transitionMode === "fade"
          ? "화면 전환 효과: 크로스페이드 (부드럽게)"
          : "화면 전환 효과: 즉시 변경 (눈 피로 최소화)";
      showAlert(
        state.transitionMode === "fade"
          ? "부드러운 크로스페이드 효과를 적용합니다."
          : "딜레이 없는 즉시 변경 효과를 적용합니다.",
      );
    });
    ctrlPanelEl.appendChild(transBtn);

    ctrlPanelEl.appendChild(createDivider());

    progressBarEl = document.createElement("div");
    progressBarEl.className = "cv-slider-container";

    progressIndicatorEl = document.createElement("div");
    progressIndicatorEl.className = "cv-slider-bar";
    progressBarEl.appendChild(progressIndicatorEl);

    const tooltip = document.createElement("div");
    tooltip.className = "cv-slider-tooltip";
    progressBarEl.appendChild(tooltip);

    progressBarEl.addEventListener("mousemove", (e) => {
      const rect = progressBarEl.getBoundingClientRect();
      const pct = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      const hoverSpreadIndex = Math.round(pct * (state.spreads.length - 1));

      tooltip.style.display = "block";
      tooltip.style.left = `${pct * 100}%`;

      const spread = state.spreads[hoverSpreadIndex];
      if (spread) {
        if (spread.length === 1) {
          tooltip.textContent = `페이지 ${spread[0] + 1}`;
        } else {
          tooltip.textContent = `페이지 ${spread[0] + 1}-${spread[1] + 1}`;
        }
      }
    });

    progressBarEl.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });

    progressBarEl.addEventListener("click", (e) => {
      const rect = progressBarEl.getBoundingClientRect();
      const pct = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      state.currentSpreadIndex = Math.round(pct * (state.spreads.length - 1));
      renderView();
    });

    ctrlPanelEl.appendChild(progressBarEl);

    pageNumEl = document.createElement("div");
    pageNumEl.className = "cv-page-info";
    pageNumEl.textContent = "0 / 0";
    ctrlPanelEl.appendChild(pageNumEl);

    ctrlPanelEl.appendChild(createDivider());

    const nextBtn = document.createElement("button");
    nextBtn.className = "cv-btn";
    nextBtn.innerHTML = "▶";
    nextBtn.title = "다음 페이지";
    nextBtn.addEventListener("click", navigateNext);
    ctrlPanelEl.appendChild(nextBtn);

    overlayEl.appendChild(ctrlPanelEl);
    document.body.appendChild(overlayEl);

    setupIdleFader();
  }

  function createDivider() {
    const div = document.createElement("div");
    div.className = "cv-divider";
    return div;
  }

  let idleTimeout = null;
  function setupIdleFader() {
    const resetIdle = (e) => {
      // Ignore keydown and click events to prevent page navigation from waking up the menu
      if (e && (e.type === "keydown" || e.type === "click")) {
        return;
      }

      if (ctrlPanelEl) {
        ctrlPanelEl.classList.remove("idle");
        document.body.style.cursor = "default";
      }
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        if (ctrlPanelEl && state.isActive) {
          ctrlPanelEl.classList.add("idle");
          document.body.style.cursor = "none";
        }
      }, 3000);
    };

    window.addEventListener("mousemove", resetIdle);
    window.addEventListener("keydown", resetIdle);
    window.addEventListener("click", resetIdle);
    resetIdle();
  }

  let alertTimeout = null;
  function showAlert(message) {
    let alertEl = document.getElementById("cv-alert-banner");
    if (!alertEl) {
      alertEl = document.createElement("div");
      alertEl.id = "cv-alert-banner";
      alertEl.className = "cv-alert";
      document.body.appendChild(alertEl);
    }
    alertEl.textContent = message;
    alertEl.classList.add("show");

    clearTimeout(alertTimeout);
    alertTimeout = setTimeout(() => {
      alertEl.classList.remove("show");
    }, 2000);
  }

  // --- 5. Rendering Engine ---

  function buildSpreads() {
    const spreads = [];
    let i = 0;

    if (state.coverMode && state.images.length > 0) {
      spreads.push([0]);
      i = 1;
    }

    while (i < state.images.length) {
      const currentImg = state.images[i];
      if (currentImg.aspect > 1.25) {
        spreads.push([i]);
        i++;
        continue;
      }

      if (i + 1 < state.images.length) {
        const nextImg = state.images[i + 1];
        if (nextImg.aspect > 1.25) {
          spreads.push([i]);
          i++;
        } else {
          spreads.push([i, i + 1]);
          i += 2;
        }
      } else {
        spreads.push([i]);
        i++;
      }
    }

    state.spreads = spreads;
  }

  function matchSpreadWithIndex(imageIndex) {
    for (let i = 0; i < state.spreads.length; i++) {
      if (state.spreads[i].includes(imageIndex)) {
        state.currentSpreadIndex = i;
        break;
      }
    }
  }

  function discoverImageAspectRatios() {
    state.images.forEach((imgObj, idx) => {
      if (imgObj.loaded) return;
      const tempImg = new Image();
      tempImg.src = imgObj.src;
      tempImg.onload = () => {
        imgObj.loaded = true;
        imgObj.width = tempImg.naturalWidth;
        imgObj.height = tempImg.naturalHeight;
        imgObj.aspect = tempImg.naturalWidth / tempImg.naturalHeight;

        const activeIndexBefore = state.spreads[state.currentSpreadIndex]
          ? state.spreads[state.currentSpreadIndex][0]
          : 0;
        buildSpreads();
        matchSpreadWithIndex(activeIndexBefore);

        if (state.isActive) {
          debouncedRenderView(); // Optimized: Debounce multiple aspect ratio updates!
        }
      };
    });
  }

  function preloadAdjacentSpreads() {
    const nextIdx = state.currentSpreadIndex + 1;
    const prevIdx = state.currentSpreadIndex - 1;

    const indicesToLoad = [];
    if (nextIdx < state.spreads.length)
      indicesToLoad.push(...state.spreads[nextIdx]);
    if (prevIdx >= 0) indicesToLoad.push(...state.spreads[prevIdx]);

    const nextNextIdx = state.currentSpreadIndex + 2;
    if (nextNextIdx < state.spreads.length)
      indicesToLoad.push(...state.spreads[nextNextIdx]);

    indicesToLoad.forEach((idx) => {
      const src = state.images[idx]?.src;
      if (src) {
        const img = new Image();
        img.src = src;
      }
    });
  }

  // Debounced render to prevent DOM accumulation from rapid aspect ratio loading calls
  let renderDebounceTimeout = null;
  function debouncedRenderView() {
    clearTimeout(renderDebounceTimeout);
    renderDebounceTimeout = setTimeout(renderView, 50);
  }

  function renderView() {
    if (!viewAreaEl || state.spreads.length === 0) return;

    const spread = state.spreads[state.currentSpreadIndex];
    if (!spread) return;

    // Find all active/old spread containers in the DOM
    const oldSpreads = Array.from(
      viewAreaEl.querySelectorAll(".cv-spread-container"),
    );

    const spreadContainer = document.createElement("div");
    spreadContainer.className = `cv-spread-container ${state.isRTL ? "rtl" : ""} ${state.transitionMode === "instant" ? "instant" : ""}`;

    // Initialize transition styling based on transitionMode
    // Start hidden to allow pre-decoding before swap
    spreadContainer.style.opacity = "0";
    if (state.transitionMode === "fade") {
      spreadContainer.style.transform = "scale(0.98)";
      spreadContainer.style.zIndex = "2";
      oldSpreads.forEach((el) => {
        el.style.zIndex = "1";
        el.style.transition = "opacity 0.2s ease, transform 0.2s ease";
      });
    } else {
      spreadContainer.style.zIndex = "2";
      oldSpreads.forEach((el) => {
        el.style.zIndex = "1";
      });
    }

    let swapDone = false;
    const triggerSwap = () => {
      if (swapDone) return;
      swapDone = true;

      clearTimeout(safeguardTimeout);

      if (state.transitionMode === "fade") {
        // Smooth fade-in
        setTimeout(() => {
          spreadContainer.style.opacity = "1";
          spreadContainer.style.transform = "scale(1)";
        }, 20);

        // Clean up old spreads after transition finishes
        setTimeout(() => {
          oldSpreads.forEach((el) => el.remove());
        }, 250);
      } else {
        // Instant swap: show new container immediately, purge old spreads instantly with 0ms black flash
        spreadContainer.style.opacity = "1";
        oldSpreads.forEach((el) => el.remove());
      }
    };

    // Track image loading completion
    let completedCount = 0;
    const onImageComplete = () => {
      completedCount++;
      if (completedCount === spread.length) {
        triggerSwap();
      }
    };

    // Safeguard timeout: if images don't load/decode in 350ms, swap anyway to show spinner/progress
    const safeguardTimeout = setTimeout(triggerSwap, 350);

    spread.forEach((imgIdx) => {
      const imgData = state.images[imgIdx];
      if (!imgData) {
        onImageComplete();
        return;
      }

      const pageWrapper = document.createElement("div");
      pageWrapper.className = "cv-page-wrapper";
      if (spread.length === 1) {
        pageWrapper.classList.add("single-page");
      }

      const spinner = document.createElement("div");
      spinner.className = "cv-spinner";
      pageWrapper.appendChild(spinner);

      pageWrapper.addEventListener("dblclick", () => {
        if (!document.fullscreenElement) {
          overlayEl.requestFullscreen().catch((err) => {
            console.error(`Error entering full-screen: ${err.message}`);
          });
        } else {
          document.exitFullscreen();
        }
      });

      const img = document.createElement("img");
      img.className = "cv-comic-image";
      img.src = imgData.src;
      img.alt = `페이지 ${imgIdx + 1}`;

      let loadAttempts = 0;
      const handleDecoded = () => {
        img.classList.add("loaded");
        spinner.remove();
        onImageComplete();
      };

      img.onload = () => {
        if (typeof img.decode === "function") {
          // Pre-decode the image asynchronously to prevent rendering/decoding flash on GPU upload
          img
            .decode()
            .then(handleDecoded)
            .catch((err) => {
              console.log(
                "[2-Page Comic Viewer] 이미지 디코딩 실패, 기본 로드 진행:",
                err,
              );
              handleDecoded();
            });
        } else {
          handleDecoded();
        }
      };

      // High-resilience multi-layered fallback logic
      img.onerror = () => {
        loadAttempts++;
        if (loadAttempts === 1) {
          console.log(
            `[2-Page Comic Viewer] 이미지 로드 실패(1차) - 일반 재로드 시도: ${imgData.src}`,
          );
          const current = img.src;
          img.src = "";
          img.src = current;
        } else if (loadAttempts === 2) {
          console.log(
            `[2-Page Comic Viewer] 이미지 로드 실패(2차) - 무레퍼러 및 캐시버스팅 우회 시도: ${imgData.src}`,
          );
          img.referrerPolicy = "no-referrer";
          const separator = imgData.src.includes("?") ? "&" : "?";
          img.src = imgData.src + separator + "cv_retry=" + Date.now();
        } else {
          spinner.remove();
          const errDiv = document.createElement("div");
          errDiv.style.color = "#ef4444";
          errDiv.style.fontWeight = "bold";
          errDiv.style.fontSize = "14px";
          errDiv.style.padding = "20px";
          errDiv.style.textAlign = "center";
          errDiv.style.background = "rgba(255,0,0,0.1)";
          errDiv.style.borderRadius = "8px";
          errDiv.innerHTML = `이미지 로드 실패<br><span style="font-size:10px;color:#94a3b8;word-break:break-all;">${imgData.src}</span>`;
          pageWrapper.appendChild(errDiv);
          onImageComplete();
        }
      };

      pageWrapper.appendChild(img);
      spreadContainer.appendChild(pageWrapper);
    });

    viewAreaEl.appendChild(spreadContainer);

    if (state.spreads.length > 1) {
      const progress =
        (state.currentSpreadIndex / (state.spreads.length - 1)) * 100;
      progressIndicatorEl.style.width = `${progress}%`;
    } else {
      progressIndicatorEl.style.width = "100%";
    }

    let pageStr = "";
    if (spread.length === 1) {
      pageStr = `${spread[0] + 1} / ${state.images.length}`;
    } else {
      pageStr = `${spread[0] + 1}-${spread[1] + 1} / ${state.images.length}`;
    }
    pageNumEl.textContent = pageStr;

    preloadAdjacentSpreads();
  }

  // --- 6. Navigation Event Handlers ---

  function navigateNext() {
    if (state.currentSpreadIndex < state.spreads.length - 1) {
      state.currentSpreadIndex++;
      renderView();
      state.nextChapterConfirm = false;
      state.prevChapterConfirm = false;
    } else {
      if (state.nextUrl) {
        if (state.nextChapterConfirm) {
          showAlert("다음 화로 이동합니다...");
          setTimeout(() => {
            window.location.href = state.isActive
              ? appendViewerParam(state.nextUrl)
              : state.nextUrl;
          }, 800);
        } else {
          state.nextChapterConfirm = true;
          showAlert(
            "마지막 페이지입니다. 한번 더 누르면 다음 화로 이동합니다.",
          );
        }
      } else {
        showAlert("마지막 페이지입니다. 다음 화 링크가 없습니다.");
      }
    }
  }

  function navigatePrev() {
    if (state.currentSpreadIndex > 0) {
      state.currentSpreadIndex--;
      renderView();
      state.nextChapterConfirm = false;
      state.prevChapterConfirm = false;
    } else {
      if (state.prevUrl) {
        if (state.prevChapterConfirm) {
          showAlert("이전 화로 이동합니다...");
          setTimeout(() => {
            window.location.href = state.isActive
              ? appendViewerParam(state.prevUrl)
              : state.prevUrl;
          }, 800);
        } else {
          state.prevChapterConfirm = true;
          showAlert("첫 페이지입니다. 한번 더 누르면 이전 화로 이동합니다.");
        }
      } else {
        showAlert("첫 페이지입니다. 이전 화 링크가 없습니다.");
      }
    }
  }

  function handleZoneClick(clickedZone) {
    if (state.isRTL) {
      if (clickedZone === "left") {
        navigateNext();
      } else {
        navigatePrev();
      }
    } else {
      if (clickedZone === "right") {
        navigateNext();
      } else {
        navigatePrev();
      }
    }
  }

  // --- 7. Keyboard & Event Binding ---

  function handleKeyDown(e) {
    if (!state.isActive) {
      if (e.key === "Escape" || e.key === "v" || e.key === "V") {
        toggleViewer(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowLeft":
        if (state.isRTL) {
          navigateNext();
        } else {
          navigatePrev();
        }
        e.preventDefault();
        break;

      case "ArrowRight":
        if (state.isRTL) {
          navigatePrev();
        } else {
          navigateNext();
        }
        e.preventDefault();
        break;

      case " ":
      case "Enter":
      case "PageDown":
        navigateNext();
        e.preventDefault();
        break;

      case "Backspace":
      case "PageUp":
        navigatePrev();
        e.preventDefault();
        break;

      case "Home":
        state.currentSpreadIndex = 0;
        renderView();
        e.preventDefault();
        break;

      case "End":
        state.currentSpreadIndex = state.spreads.length - 1;
        renderView();
        e.preventDefault();
        break;

      case "Escape":
        toggleViewer(false);
        e.preventDefault();
        break;
    }
  }

  function toggleViewer(forceState) {
    state.isActive = forceState !== undefined ? forceState : !state.isActive;
    if (state.isActive) {
      document.body.classList.add("cv-active-mode");
      if (overlayEl) {
        overlayEl.classList.add("active");
        renderView();
      }
      if (manualLaunchBtn) {
        manualLaunchBtn.style.display = "none";
      }
      showAlert("2페이지 가로 뷰어를 활성화했습니다.");
    } else {
      document.body.classList.remove("cv-active-mode");
      if (overlayEl) {
        overlayEl.classList.remove("active");
      }
      if (manualLaunchBtn) {
        manualLaunchBtn.style.display = "flex";
      }
      showAlert(
        "스크롤형 보기로 복구되었습니다. (ESC 또는 버튼으로 다시 켜기)",
      );
    }
  }

  // --- 8. Initialization & Dynamic Retrying Orchestrator ---

  let retryCount = 0;
  const maxRetries = 10;

  function runScraperAndInit() {
    const scrapedImages = scrapeImages();

    if (scrapedImages.length >= 3) {
      state.images = scrapedImages;
      console.log(
        `[2-Page Comic Viewer] ${state.images.length}장의 만화 이미지를 감지하고 뷰어를 준비합니다.`,
      );

      scrapeNavigationLinks();
      buildSpreads();
      injectStyles();
      createOverlay();

      // Auto-launch the viewer ONLY if hasViewerFlag is true!
      if (hasViewerFlag) {
        toggleViewer(true);
      } else {
        toggleViewer(false);
      }

      // Asynchronously discover aspects (specifically checks for wide images)
      discoverImageAspectRatios();

      // Set up key controls (bind only once)
      if (!state.keyEventsBound) {
        window.addEventListener("keydown", handleKeyDown);
        state.keyEventsBound = true;
      }

      // Create floating launch badge for future manual toggles
      createManualLaunchButton();
      if (state.isActive) {
        manualLaunchBtn.style.display = "none";
      }
      return true;
    }

    return false;
  }

  function initViewerWithRetries() {
    injectStyles();

    // Always build the manual launcher badge immediately so the user has full manual control even if autoscrape fails
    createManualLaunchButton();

    // 1. Try immediate initiation
    const success = runScraperAndInit();
    if (success) return;

    // 2. Retry polling loop (for dynamically loaded or lazy rendered boards)
    const pollInterval = setInterval(() => {
      retryCount++;
      console.log(
        `[2-Page Comic Viewer] 이미지 탐색 재시도 중... (${retryCount}/${maxRetries})`,
      );
      const retrySuccess = runScraperAndInit();

      if (retrySuccess || retryCount >= maxRetries) {
        clearInterval(pollInterval);
        if (!retrySuccess) {
          console.log(
            '[2-Page Comic Viewer] 이미지 자동 탐색 한도를 초과했습니다. 우측 하단의 "📖 2Page 뷰어" 버튼을 통해 수동 활성화가 가능합니다.',
          );
        }
      }
    }, 800);

    // 3. Dynamic MutationObserver as a robust backup for infinite scrolling / delayed DOM mutations
    const observer = new MutationObserver((mutations) => {
      if (state.isActive) return;

      const addedImgs = mutations.some((m) =>
        Array.from(m.addedNodes).some(
          (node) =>
            node.tagName === "IMG" ||
            (node.querySelectorAll && node.querySelectorAll("img").length > 0),
        ),
      );
      if (addedImgs) {
        console.log(
          "[2-Page Comic Viewer] DOM 내 이미지 노드 유입 감지. 이미지 재탐색 실행.",
        );
        const obsSuccess = runScraperAndInit();
        if (obsSuccess) {
          observer.disconnect();
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
  }

  // Autostart orchestrator
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    setTimeout(initViewerWithRetries, 200);
  } else {
    window.addEventListener("DOMContentLoaded", initViewerWithRetries);
  }
})();
