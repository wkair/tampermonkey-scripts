import './style.css';

// TypeScript declarations for Tampermonkey Globals
declare const unsafeWindow: any;
declare function GM_getValue(key: string, defaultValue: any): any;
declare function GM_setValue(key: string, value: any): void;
declare function GM_registerMenuCommand(name: string, fn: () => any, accessKey?: string): void;

// --- 0. URL Guard ---
const urlParams = new URLSearchParams(window.location.search);
if (!urlParams.has("wr_id")) {
  console.log(
    "[2-Page Comic Viewer] 에피소드 목록/작품 정보 페이지이므로 스크립트 활성화를 건너뜁니다.",
  );
} else {
  const hasViewerFlag = urlParams.get("cv_view") === "true";

  console.log(
    "[2-Page Comic Viewer] 스크립트 로드됨. 에피소드 페이지 확인 완료.",
  );

  // --- 1. Persistent Storage Helpers ---
  function getStorage(key: string, defaultValue: any): any {
    if (typeof GM_getValue !== "undefined") {
      return GM_getValue(key, defaultValue);
    }
    const val = localStorage.getItem("cv_" + key);
    return val !== null ? JSON.parse(val) : defaultValue;
  }

  function setStorage(key: string, value: any): void {
    if (typeof GM_setValue !== "undefined") {
      GM_setValue(key, value);
      return;
    }
    localStorage.setItem("cv_" + key, JSON.stringify(value));
  }

  // Read initial active state from storage
  let shouldBeActive = getStorage("viewerActive", false);
  if (hasViewerFlag) {
    shouldBeActive = true;
    setStorage("viewerActive", true);
  }

  // URL Resolver using native browser engine
  function resolveUrl(src: string): string {
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
  function appendViewerParam(url: string): string {
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

  interface ComicImage {
    src: string;
    aspect: number;
    loaded: boolean;
    element?: HTMLImageElement;
    width?: number;
    height?: number;
  }

  // --- 2. State Management ---
  const state = {
    isActive: false, // Set to false initially, will set true on successful load
    images: [] as ComicImage[], // Array of { src, aspect, element }
    spreads: [] as number[][], // Array of spreads, e.g. [[0], [1, 2], [3, 4]]
    currentSpreadIndex: 0, // Index in state.spreads
    isRTL: getStorage("isRTL", true), // Japanese reading direction (Right to Left)
    coverMode: getStorage("coverMode", true), // Keep the first page single
    nextTarget: null as string | HTMLElement | null, // Next episode URL string or DOM element
    prevTarget: null as string | HTMLElement | null, // Prev episode URL string or DOM element
    keyEventsBound: false, // Prevent redundant key listener registration
    nextChapterConfirm: false, // Confirm going to the next chapter on double input
    prevChapterConfirm: false, // Confirm going to the prev chapter on double input
    transitionMode: getStorage("transitionMode", "instant"), // Transition style: 'instant' or 'fade'
    currentRenderId: 0,
  };

  // --- 3. Robust Heuristics & Global Variables Engine ---

  // Find all valid cartoon/manga images
  function scrapeImages(): ComicImage[] {
    const pageWindow =
      typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    let urls: string[] = [];

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
    const candidates: { element: HTMLImageElement; src: string }[] = [];

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

    let gnuboardContainer: Element | null = null;
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

    let filteredCandidates: { element: HTMLImageElement; src: string }[] = [];

    if (gnuboardContainer) {
      filteredCandidates = candidates.filter((cand) =>
        gnuboardContainer!.contains(cand.element),
      );
    }

    if (filteredCandidates.length < 3) {
      const groups = new Map<Element, number>();
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
      let bestContainer: Element | null = null;
      for (const [container, count] of groups.entries()) {
        if (count > maxCount) {
          maxCount = count;
          bestContainer = container;
        }
      }

      if (bestContainer && maxCount >= 3) {
        filteredCandidates = candidates.filter((cand) =>
          bestContainer!.contains(cand.element),
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

    const uniqueUrls = new Set<string>();
    const finalImages: ComicImage[] = [];
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
  function scrapeNavigationLinks(): void {
    const anchors = Array.from(
      document.querySelectorAll('a, button, [role="button"]'),
    ) as HTMLElement[];

    const nextRegex =
      /(다음\s*화|다음\s*편|다음\s*에피소드|다음\s*글|다음\s*화\s*보기|next\s*ep|next\s*chapter|next\s*vol|▶|→)/i;
    const prevRegex =
      /(이전\s*화|이전\s*편|이전\s*에피소드|이전\s*글|이전\s*화\s*보기|prev\s*ep|prev\s*chapter|prev\s*vol|◀|←)/i;

    let nextCandidate: string | HTMLElement | null = null;
    let prevCandidate: string | HTMLElement | null = null;

    for (const anchor of anchors) {
      const text = (anchor.textContent || anchor.innerText || "").trim();
      const href = anchor.getAttribute("href") || "";
      const className = (anchor.className || "").toLowerCase();
      const idName = (anchor.id || "").toLowerCase();

      const isNext =
        nextRegex.test(text) ||
        className.includes("btn_nxt") ||
        className.includes("next-link") ||
        idName.includes("next");
      const isPrev =
        prevRegex.test(text) ||
        className.includes("btn_prv") ||
        className.includes("prev-link") ||
        idName.includes("prev");

      if (isNext && !nextCandidate) {
        if (href && !href.startsWith("javascript:") && !href.startsWith("#")) {
          nextCandidate = resolveUrl(href);
        } else {
          nextCandidate = anchor;
        }
      }
      if (isPrev && !prevCandidate) {
        if (href && !href.startsWith("javascript:") && !href.startsWith("#")) {
          prevCandidate = resolveUrl(href);
        } else {
          prevCandidate = anchor;
        }
      }
    }

    // Gnuboard specific navigation selectors backup
    if (!nextCandidate) {
      const nxtEl = document.querySelector(
        ".btn_nxt, .bo_v_nb .btn_next, a.btn_next, .right-episode.next, button.next",
      ) as HTMLElement;
      if (nxtEl) {
        const onclickText = nxtEl.getAttribute("onclick") || "";
        const match = onclickText.match(
          /location\.href\s*=\s*['"]([^'"]+)['"]/,
        );
        if (match) {
          nextCandidate = resolveUrl(match[1]);
        } else {
          nextCandidate = nxtEl;
        }
      }
    }
    if (!prevCandidate) {
      const prvEl = document.querySelector(
        ".btn_prv, .bo_v_nb .btn_prev, a.btn_prev, .left-episode.prev, button.prev",
      ) as HTMLElement;
      if (prvEl) {
        const onclickText = prvEl.getAttribute("onclick") || "";
        const match = onclickText.match(
          /location\.href\s*=\s*['"]([^'"]+)['"]/,
        );
        if (match) {
          prevCandidate = resolveUrl(match[1]);
        } else {
          prevCandidate = prvEl;
        }
      }
    }

    state.nextTarget = nextCandidate;
    state.prevTarget = prevCandidate;

    const getTargetLogStr = (target: string | HTMLElement | null): string => {
      if (!target) return "없음";
      if (typeof target === "string") return target;
      return `DOM Element (${target.tagName.toLowerCase()}${target.className ? "." + target.className.replace(/\s+/g, ".") : ""})`;
    };

    console.log(
      `[2-Page Comic Viewer] 다음화 링크: ${getTargetLogStr(state.nextTarget)}, 이전화 링크: ${getTargetLogStr(state.prevTarget)}`,
    );
  }

  // Unified robust navigation execution helper
  function performNavigation(target: string | HTMLElement | null): void {
    if (!target) return;
    if (typeof target === "string") {
      window.location.href = state.isActive ? appendViewerParam(target) : target;
    } else if (target && typeof target.click === "function") {
      // If it's an <a> anchor element with a valid href, navigate directly with cv_view preserved
      const href = target.getAttribute("href");
      if (href && !href.startsWith("javascript:") && !href.startsWith("#")) {
        const fullUrl = resolveUrl(href);
        window.location.href = state.isActive ? appendViewerParam(fullUrl) : fullUrl;
      } else {
        // Fallback to triggering the click event (useful for onclick scripts / custom ajax buttons)
        target.click();
      }
    }
  }

  // --- 4. Premium Overlay UI & Styles ---
  let overlayEl: HTMLDivElement | null = null;
  let viewAreaEl: HTMLDivElement | null = null;
  let ctrlPanelEl: HTMLDivElement | null = null;
  let progressBarEl: HTMLDivElement | null = null;
  let progressIndicatorEl: HTMLDivElement | null = null;
  let pageNumEl: HTMLDivElement | null = null;
  let manualLaunchBtn: HTMLDivElement | null = null; // Tiny floating manual toggle badge

  // Injected CSS style is handled automatically by Vite-plugin-monkey bundling './style.css'
  // So injectStyles() is now a no-op helper
  function injectStyles(): void {
    // No-op (handled by bundle)
  }

  // Creates manual activation button in the corner
  function createManualLaunchButton(): void {
    if (manualLaunchBtn) return;

    manualLaunchBtn = document.createElement("div");
    manualLaunchBtn.className = "cv-manual-launcher";
    manualLaunchBtn.innerHTML = "◫ 2Page 뷰어";
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

  function createOverlay(): void {
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
    prevBtn.innerHTML = "←";
    prevBtn.title = "이전 페이지";
    prevBtn.addEventListener("click", navigatePrev);
    ctrlPanelEl.appendChild(prevBtn);

    ctrlPanelEl.appendChild(createDivider());

    const directionBtn = document.createElement("button");
    directionBtn.className = `cv-btn cv-toggle-btn ${state.isRTL ? "active" : ""}`;
    directionBtn.id = "cv-dir-btn";
    directionBtn.innerHTML = state.isRTL ? "⇄ RTL" : "⇄ LTR";
    directionBtn.title = state.isRTL
      ? "읽는 방향: 우측에서 좌측 (RTL)"
      : "읽는 방향: 좌측에서 우측 (LTR)";
    directionBtn.addEventListener("click", () => {
      state.isRTL = !state.isRTL;
      setStorage("isRTL", state.isRTL);
      directionBtn.classList.toggle("active", state.isRTL);
      directionBtn.innerHTML = state.isRTL ? "⇄ RTL" : "⇄ LTR";
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
    coverBtn.innerHTML = "◫ 표지";
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
    transBtn.innerHTML = state.transitionMode === "fade" ? "✦ 페이드" : "≫ 즉시";
    transBtn.title =
      state.transitionMode === "fade"
        ? "화면 전환 효과: 크로스페이드 (부드럽게)"
        : "화면 전환 효과: 즉시 변경 (눈 피로 최소화)";
    transBtn.addEventListener("click", () => {
      state.transitionMode =
        state.transitionMode === "fade" ? "instant" : "fade";
      setStorage("transitionMode", state.transitionMode);
      transBtn.classList.toggle("active", state.transitionMode === "fade");
      transBtn.innerHTML = state.transitionMode === "fade" ? "✦ 페이드" : "≫ 즉시";
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
      const rect = progressBarEl!.getBoundingClientRect();
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
      const rect = progressBarEl!.getBoundingClientRect();
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
    nextBtn.innerHTML = "→";
    nextBtn.title = "다음 페이지";
    nextBtn.addEventListener("click", navigateNext);
    ctrlPanelEl.appendChild(nextBtn);

    overlayEl.appendChild(ctrlPanelEl);
    document.body.appendChild(overlayEl);

    setupIdleFader();
  }

  function createDivider(): HTMLDivElement {
    const div = document.createElement("div");
    div.className = "cv-divider";
    return div;
  }

  let idleTimeout: any = null;
  function setupIdleFader(): void {
    const resetIdle = () => {
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
    resetIdle();
  }

  let alertTimeout: any = null;
  function showAlert(message: string): void {
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
      alertEl!.classList.remove("show");
    }, 2000);
  }

  // --- 5. Rendering Engine ---

  // Standardize spread building
  function buildSpreads(): void {
    const spreads: number[][] = [];
    let i = 0;

    if (state.coverMode && state.images.length > 0) {
      spreads.push([0]);
      i = 1;
    }

    while (i < state.images.length) {
      const currentImg = state.images[i];
      if (!currentImg) {
        i++;
        continue;
      }
      
      if (currentImg.aspect > 1.25) {
        spreads.push([i]);
        i++;
        continue;
      }

      if (i + 1 < state.images.length) {
        const nextImg = state.images[i + 1];
        if (nextImg && nextImg.aspect > 1.25) {
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

  function matchSpreadWithIndex(imageIndex: number): void {
    for (let i = 0; i < state.spreads.length; i++) {
      if (state.spreads[i].includes(imageIndex)) {
        state.currentSpreadIndex = i;
        break;
      }
    }
  }

  function discoverImageAspectRatios(): void {
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
          debouncedRenderView(); // Debounce multiple aspect ratio updates!
        }
      };
    });
  }

  function preloadAdjacentSpreads(): void {
    const nextIdx = state.currentSpreadIndex + 1;
    const prevIdx = state.currentSpreadIndex - 1;

    const indicesToLoad: number[] = [];
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
  let renderDebounceTimeout: any = null;
  function debouncedRenderView(): void {
    clearTimeout(renderDebounceTimeout);
    renderDebounceTimeout = setTimeout(renderView, 50);
  }

  function renderView(): void {
    if (!viewAreaEl || state.spreads.length === 0) return;

    const spread = state.spreads[state.currentSpreadIndex];
    if (!spread) return;

    // Track active render call to prevent race conditions during rapid navigation
    state.currentRenderId = (state.currentRenderId || 0) + 1;
    const myRenderId = state.currentRenderId;

    // Find all active/old spread containers in the DOM
    const oldSpreads = Array.from(
      viewAreaEl.querySelectorAll(".cv-spread-container"),
    ) as HTMLElement[];

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
        el.style.transition = "none";
      });
    }

    let swapDone = false;
    const triggerSwap = () => {
      if (swapDone) return;
      
      // If this render call is no longer the active one, abort swap and discard this container
      if (myRenderId !== state.currentRenderId) {
        spreadContainer.remove();
        return;
      }

      swapDone = true;
      clearTimeout(safeguardTimeout);

      if (state.transitionMode === "fade") {
        // Smooth fade-in
        setTimeout(() => {
          if (myRenderId !== state.currentRenderId) return;
          spreadContainer.style.opacity = "1";
          spreadContainer.style.transform = "scale(1)";
        }, 20);

        // Clean up old spreads after transition finishes
        setTimeout(() => {
          if (myRenderId !== state.currentRenderId) return;
          oldSpreads.forEach((el) => el.remove());
        }, 250);
      } else {
        // Instant swap: show new container immediately
        spreadContainer.style.opacity = "1";
        
        // Use double requestAnimationFrame to ensure the new container is fully painted
        // on screen by the browser before removing the old spreads, avoiding any 1-frame black flash.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (myRenderId !== state.currentRenderId) return;
            oldSpreads.forEach((el) => el.remove());
          });
        });
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

    // Safeguard timeout: if images don't load/decode in 5000ms, swap anyway to show spinner/progress
    const safeguardTimeout = setTimeout(triggerSwap, 5000);

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
          overlayEl!.requestFullscreen().catch((err) => {
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
        if (myRenderId !== state.currentRenderId) return;
        if (typeof img.decode === "function") {
          // Pre-decode the image asynchronously to prevent rendering/decoding flash on GPU upload
          img
            .decode()
            .then(() => {
              if (myRenderId !== state.currentRenderId) return;
              handleDecoded();
            })
            .catch((err) => {
              console.log(
                "[2-Page Comic Viewer] 이미지 디코딩 실패, 기본 로드 진행:",
                err,
              );
              if (myRenderId !== state.currentRenderId) return;
              handleDecoded();
            });
        } else {
          handleDecoded();
        }
      };

      // High-resilience fallback logic
      img.onerror = () => {
        if (myRenderId !== state.currentRenderId) return;
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
      progressIndicatorEl!.style.width = `${progress}%`;
    } else {
      progressIndicatorEl!.style.width = "100%";
    }

    let pageStr = "";
    if (spread.length === 1) {
      pageStr = `${spread[0] + 1} / ${state.images.length}`;
    } else {
      pageStr = `${spread[0] + 1}-${spread[1] + 1} / ${state.images.length}`;
    }
    pageNumEl!.textContent = pageStr;

    preloadAdjacentSpreads();
  }

  // --- 6. Navigation Event Handlers ---

  function navigateNext(): void {
    if (state.currentSpreadIndex < state.spreads.length - 1) {
      state.currentSpreadIndex++;
      renderView();
      state.nextChapterConfirm = false;
      state.prevChapterConfirm = false;
    } else {
      if (state.nextTarget) {
        if (state.nextChapterConfirm) {
          showAlert("다음 화로 이동합니다...");
          setTimeout(() => {
            performNavigation(state.nextTarget);
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

  function navigatePrev(): void {
    if (state.currentSpreadIndex > 0) {
      state.currentSpreadIndex--;
      renderView();
      state.nextChapterConfirm = false;
      state.prevChapterConfirm = false;
    } else {
      if (state.prevTarget) {
        if (state.prevChapterConfirm) {
          showAlert("이전 화로 이동합니다...");
          setTimeout(() => {
            performNavigation(state.prevTarget);
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

  function handleZoneClick(clickedZone: "left" | "right"): void {
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

  function handleKeyDown(e: KeyboardEvent): void {
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

  function toggleViewer(forceState?: boolean): void {
    state.isActive = forceState !== undefined ? forceState : !state.isActive;
    setStorage("viewerActive", state.isActive);
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

  function runScraperAndInit(): boolean {
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

      // Auto-launch the viewer if shouldBeActive is true!
      if (shouldBeActive) {
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
        manualLaunchBtn!.style.display = "none";
      }
      return true;
    }

    return false;
  }

  function initViewerWithRetries(): void {
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
          (node: any) =>
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
}
