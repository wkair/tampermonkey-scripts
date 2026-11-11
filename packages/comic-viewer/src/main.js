"use strict";

(() => {
  const VERSION = "261105000003";
  const SPREAD_RATIO = 1.2;
  const RESUME_KEY = "toki-viewer.resume-episode";
  const COVER_KEY = "toki-viewer.first-page-alone";
  let coverPreference = false;
  try { coverPreference = localStorage.getItem(COVER_KEY) === "true"; }
  catch (_) { /* Keep the session preference when browser storage is blocked. */ }
  const layouts = [
    { root: "[data-theme-viewer-images], .theme-viewer-images", theme: true },
    { root: ".vw-imgs", theme: false },
    { root: "div.view-padding", theme: false },
  ];

  function findImageArea() {
    for (const layout of layouts) {
      const root = document.querySelector(layout.root);
      if (root) return { root, theme: layout.theme };
    }
    return null;
  }

  function normalizeUrl(value, allowRelative = true) {
    if (typeof value !== "string" || !value.trim()) return null;
    const raw = value.trim();
    if (!allowRelative && !/^(https?:\/\/|\/|blob:|data:image\/)/i.test(raw)) return null;
    try {
      const url = new URL(raw, document.baseURI);
      if (/^(https?:|blob:)$/.test(url.protocol)) return url.href;
      if (raw.startsWith("data:image/")) return raw;
    } catch (_) {}
    return null;
  }

  function readPage(image, theme) {
    // Legacy sites also use randomly named data-* attributes. Only accept URLs,
    // never data-page, data-width, etc. Empty img.src can resolve to the page URL.
    const candidates = [
      image.getAttribute("data-src"),
      image.getAttribute("data-original"),
      image.getAttribute("data-lazy-src"),
      ...Object.values(image.dataset).map((value) => normalizeUrl(value, false)),
      image.getAttribute("src"),
    ];
    const src = candidates.map((value) => normalizeUrl(value)).find(Boolean);
    if (!src) return null;
    return {
      src,
      alt: image.alt || "",
      referrerPolicy: theme ? "no-referrer" : image.referrerPolicy || "",
    };
  }

  function routeKey(url = location.href) {
    const parsed = new URL(url, document.baseURI);
    return parsed.pathname.replace(/\/$/, "") +
      (/^\/(manhwa|webtoon)\/[^/]+\/[^/]+\/?$/.test(parsed.pathname) ? "" : parsed.search);
  }

  function collectSnapshot(guard) {
    const area = findImageArea();
    const empty = { entries: [], ready: 0, current: false };
    if (!area) return empty;
    const dataElement = area.theme && document.getElementById("theme-viewer-data");
    let config = null;
    if (dataElement) {
      try { config = JSON.parse(dataElement.textContent); } catch (_) { return empty; }
    }
    const scope = config?.scopePath;
    const current = routeKey() === guard.route && (!scope || routeKey(scope) === guard.route);
    const slots = area.theme ? [...area.root.querySelectorAll("[data-theme-page]")] : [];
    let entries;
    if (slots.length || Array.isArray(config?.images)) {
      const slotMap = new Map(slots.map((slot) => [slot.dataset.themePage, slot]));
      const keys = Array.isArray(config?.images) && config.images.length
        ? config.images.map((meta) => String(meta.page)) : slots.map((slot) => slot.dataset.themePage);
      entries = [...new Set(keys)].map((key) => {
        const slot = slotMap.get(key);
        const img = slot?.querySelector("img");
        return { key, image: img, page: img ? readPage(img, true) : null, siteError: !!slot?.classList.contains("is-error") };
      });
    } else {
      entries = [...area.root.querySelectorAll("img")]
        .filter((img) => area.theme || img.offsetParent !== null)
        .map((img, index) => ({ key: String(index + 1), image: img, page: readPage(img, area.theme), siteError: false }));
    }
    // Metadata can change before the old image nodes are replaced. A changed URL
    // alone is not evidence that those images belong to the new episode.
    entries = entries.map((entry) => ({
      ...entry,
      rawSrc: entry.page?.src,
      page: current && (!entry.page || guard.blockedSources.get(entry.image) !== entry.page.src) ? entry.page : null,
    }));
    return { entries, ready: entries.filter((entry) => entry.page).length, current };
  }

  function observeSource(callback) {
    const roots = "[data-theme-viewer-images], .theme-viewer-images, .vw-imgs, div.view-padding, #theme-viewer-data";
    const episodeControls = "a.theme-viewer-prev, a.theme-viewer-next, .vw-act, #goPrevBtn, #goNextBtn";
    const added = roots + ", .theme-viewer-nav, .toon-nav, " + episodeControls;
    const observer = new MutationObserver((records) => {
      if (records.some((record) => {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (target?.closest("[data-toki-viewer-ui]")) return false;
        if (target?.closest(roots + ", " + episodeControls)) return true;
        return record.type === "childList" && [...record.addedNodes, ...record.removedNodes]
          .some((node) => node.nodeType === 1 && (node.matches(added) || node.querySelector(added)));
      })) callback();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => observer.disconnect();
  }

  function bindAction(element, action, onError = console.error) {
    let touch = null;
    let lastTouch = -Infinity;
    const invoke = () => {
      if (element.disabled) return;
      try { Promise.resolve(action()).catch(onError); }
      catch (error) { onError(error); }
    };
    // Property handlers share a slot with page scripts in Firefox. Register a
    // listener instead, and handle a tap even if a site cancels the later click.
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.detail > 0 && Date.now() - lastTouch < 800) return;
      invoke();
    }, { capture: true });
    element.addEventListener("touchstart", (event) => {
      const point = event.touches.length === 1 ? event.touches[0] : null;
      touch = point ? { id: point.identifier, x: point.clientX, y: point.clientY, time: Date.now() } : null;
    }, { passive: true });
    element.addEventListener("touchmove", (event) => {
      const point = [...event.touches].find((point) => point.identifier === touch?.id);
      if (!point || Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > 10) touch = null;
    }, { passive: true });
    element.addEventListener("touchcancel", () => { touch = null; }, { passive: true });
    element.addEventListener("touchend", (event) => {
      const start = touch;
      touch = null;
      const point = [...event.changedTouches].find((point) => point.identifier === start?.id);
      if (!start || !point || event.touches.length || Date.now() - start.time > 800 ||
          Math.hypot(point.clientX - start.x, point.clientY - start.y) > 10) return;
      lastTouch = Date.now();
      event.preventDefault();
      event.stopPropagation();
      invoke();
    }, { passive: false, capture: true });
  }

  function findEpisodeControl(direction, candidate = null) {
    const selectors = direction === "previous"
      ? ["a.theme-viewer-prev[href]", ".vw-act[aria-label='이전화']", "#goPrevBtn"]
      : ["a.theme-viewer-next[href]", ".vw-act[aria-label='다음화']", "#goNextBtn"];
    for (const selector of selectors) {
      const buttons = candidate ? (candidate.matches(selector) ? [candidate] : []) : document.querySelectorAll(selector);
      for (const button of buttons) {
        if (button.disabled || button.getAttribute("aria-disabled") === "true" || button.classList.contains("disabled")) continue;
        if (button.tagName === "A") {
          const href = button.getAttribute("href");
          if (!href || href.startsWith("#")) continue;
          try {
            const url = new URL(href, document.baseURI);
            if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin || routeKey(url.href) === routeKey()) continue;
          } catch (_) { continue; }
        }
        return button;
      }
    }
    return null;
  }

  function getOrigin() {
    return ["manatoki", "newtoki", "booktoki"].find((name) => location.hostname.includes(name)) || "unknown";
  }

  function makeButton(label, action, onError) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = "flex:none;min-height:44px;padding:8px 12px;border:1px solid #aaa;border-radius:6px;background:#fff;color:#111;font:14px sans-serif;touch-action:manipulation;pointer-events:auto;cursor:pointer";
    bindAction(button, action, onError);
    return button;
  }

  function spreadStarts(count, cover, single = () => false) {
    const starts = [];
    for (let i = 0; i < count;) {
      starts.push(i);
      // A normal page before a combined image must finish on its own.
      i += (cover && i === 0) || single(i) || single(i + 1) ? 1 : 2;
    }
    return starts;
  }

  function setToolIcon(button, label, name) {
    const paths = {
      left: ["m14 6-6 6 6 6"],
      right: ["m10 6 6 6-6 6"],
      episodeLeft: ["m12 6-6 6 6 6m6-12-6 6 6 6"],
      episodeRight: ["m6 6 6 6-6 6m6-12 6 6-6 6"],
      rtl: ["M20 7H4m5-5L4 7l5 5M4 17h16m-5-5 5 5-5 5"],
      ltr: ["M4 7h16m-5-5 5 5-5 5M20 17H4m5-5-5 5 5 5"],
      cover: ["M12 5v15M3 4h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6v15h-6a3 3 0 0 0-3 2 3 3 0 0 0-3-2H3Z"],
      single: ["M3 5h18v14H3Z"],
      paired: ["M3 5h18v14H3Zm9 0v14"],
      expand: ["M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"],
      collapse: ["M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"],
      close: ["m6 6 12 12M18 6 6 18"],
    };
    button.title = label;
    button.setAttribute("aria-label", label);
    button.style.cssText = "flex:none;position:relative;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;min-height:44px;padding:0;border:0;border-radius:12px;color:#e5eaf3;background:transparent;touch-action:manipulation;cursor:pointer;transition:background .15s,color .15s,opacity .15s";
    if (button.getAttribute("aria-pressed") === "true") {
      button.style.background = "rgba(139,181,255,.18)";
      button.style.color = "#b9d2ff";
    }
    if (button.dataset.icon === name && button.textContent === label) return;
    button.dataset.icon = name;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.style.pointerEvents = "none";
    for (const d of paths[name]) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    const text = document.createElement("span");
    text.textContent = label;
    text.style.cssText = "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap";
    button.replaceChildren(svg, text);
  }

  function createSpreadViewer(initial, onClose, autoFullscreen = false, onEpisodeNavigation = () => {}) {
    let snapshot = initial;
    let start = 0;
    let cover = coverPreference;
    let rtl = getOrigin() === "manatoki" || /^\/manhwa(?:-end)?\//.test(location.pathname);
    let closed = false;
    let ownsFullscreen = false;
    let fullscreenPending = false;
    let controlsVisible = true;
    let controlsTimer;
    const imageCache = new Map();
    // Keep only small classification values after image objects are evicted.
    // URL-based keys prevent a replaced source from inheriting an old decision.
    const pageTypes = new Map();
    const singleOverrides = new Map();
    const focusBefore = document.activeElement;
    const htmlStyle = document.documentElement.style;
    const overflow = htmlStyle.getPropertyValue("overflow");
    const overflowPriority = htmlStyle.getPropertyPriority("overflow");
    const dialog = document.createElement("dialog");
    dialog.dataset.tokiViewerUi = "";
    dialog.dataset.tokiSpreadViewer = "";
    dialog.setAttribute("aria-label", "만화 두 쪽 보기");
    dialog.style.cssText = "position:fixed;inset:0;margin:0;padding:0;border:0;width:100%;max-width:none;height:100%;height:100dvh;max-height:none;z-index:2147483647;background:#111;color:white;display:block;box-sizing:border-box;font:14px/1.4 sans-serif";
    const toolbar = document.createElement("div");
    toolbar.dataset.tokiToolbar = "";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "두 쪽 보기 조작 메뉴");
    toolbar.style.cssText = "position:absolute;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2;box-sizing:border-box;width:max-content;max-width:calc(100% - 24px);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px;padding:7px;border:1px solid #ffffff24;border-radius:22px;background:rgba(20,24,32,.9);backdrop-filter:blur(20px);box-shadow:0 8px 32px #0006,0 1px 0 #ffffff0d inset";
    const menuStyle = document.createElement("style");
    menuStyle.textContent = "[data-toki-toolbar] button:disabled{opacity:.28;cursor:default}[data-toki-toolbar] button:focus-visible{outline:2px solid #a8caff;outline-offset:1px}@media(hover:hover){[data-toki-toolbar] button:not(:disabled):hover{background:#ffffff18!important}}";
    const count = document.createElement("span");
    count.dataset.tokiPageCount = "";
    count.setAttribute("role", "status");
    count.style.cssText = "min-width:98px;text-align:center;color:#f0f3fa;font:500 14px/1.4 system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.3px;white-space:nowrap";
    const notice = document.createElement("div");
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:absolute;inset:auto 0 0;z-index:3;max-height:30%;overflow:auto;background:#222e;color:#ffcece;text-align:center";
    const report = (error) => {
      notice.textContent = `실행 오류: ${error?.message || String(error)}`;
      console.error("[토끼 뷰어]", error);
    };
    const previous = makeButton("이전 2쪽", () => move(-1), report);
    const next = makeButton("다음 2쪽", () => move(1), report);
    const previousEpisode = makeButton("이전화", () => changeEpisode("previous"), report);
    const nextEpisode = makeButton("다음화", () => changeEpisode("next"), report);
    const direction = makeButton("", () => { rtl = !rtl; draw(); }, report);
    const pairing = makeButton("첫 장 단독", () => {
      cover = !cover;
      coverPreference = cover;
      try { localStorage.setItem(COVER_KEY, String(cover)); }
      catch (_) { /* Reopening and SPA navigation still retain the choice. */ }
      const starts = getStarts();
      start = [...starts].reverse().find((index) => index <= start) ?? 0;
      draw();
    }, report);
    const closeButton = makeButton("닫기", close, report);
    const fullscreenButton = makeButton("전체화면", toggleFullscreen, report);
    const pager = document.createElement("div");
    pager.style.cssText = "display:flex;align-items:center;gap:0";
    pager.append(previousEpisode, previous, count, next, nextEpisode);
    const tools = document.createElement("div");
    tools.style.cssText = "display:flex;align-items:center;gap:2px;padding-left:5px;border-left:1px solid #ffffff1c";
    tools.append(direction, pairing, fullscreenButton, closeButton);
    toolbar.append(pager, tools);
    setToolIcon(closeButton, "닫기", "close");

    function updateFullscreenButton(event) {
      if (!closed && event?.type === "fullscreenchange" && document.fullscreenElement === document.documentElement &&
          dialog.open && typeof dialog.close === "function" && typeof dialog.showModal === "function") {
        // The fullscreen root was added to the top layer after the dialog.
        // Re-open the modal above it so both comic pages remain visible.
        try { dialog.close(); dialog.showModal(); }
        catch (_) { dialog.setAttribute("open", ""); }
      }
      fullscreenButton.disabled = fullscreenPending;
      fullscreenButton.setAttribute("aria-pressed", String(!!document.fullscreenElement));
      setToolIcon(fullscreenButton, document.fullscreenElement ? "전체화면 해제" : "전체화면", document.fullscreenElement ? "collapse" : "expand");
      if (document.fullscreenElement !== document.documentElement) ownsFullscreen = false;
    }

    function toggleFullscreen() {
      if (closed || fullscreenPending) return;
      notice.textContent = "";
      if (document.fullscreenElement) {
        return document.exitFullscreen().catch(report);
      }
      // A <dialog> cannot itself request fullscreen. Fullscreen the document
      // root so the open two-page dialog stays in the top layer above the page.
      if (typeof document.documentElement.requestFullscreen !== "function" || document.fullscreenEnabled === false) {
        notice.textContent = "이 환경에서는 전체화면을 사용할 수 없습니다.";
        return;
      }
      fullscreenPending = true;
      fullscreenButton.disabled = true;
      ownsFullscreen = true;
      let request;
      try {
        // Invoke directly within the user's tap/click, before any async work.
        request = document.documentElement.requestFullscreen({ navigationUI: "hide" });
      } catch (error) { request = Promise.reject(error); }
      return Promise.resolve(request).then(() => {
        if (closed && document.fullscreenElement === document.documentElement) return document.exitFullscreen();
        if (!closed && document.fullscreenElement === document.documentElement) setControlsVisible(false);
      }).catch((error) => {
        ownsFullscreen = false;
        if (!closed) {
          notice.textContent = `전체화면 요청이 거절됐습니다. 다시 눌러주세요. (${error?.message || String(error)})`;
        }
      }).finally(() => {
        fullscreenPending = false;
        updateFullscreenButton();
      });
    }
    const spread = document.createElement("div");
    spread.dataset.tokiSpread = "";
    spread.tabIndex = -1;
    spread.style.cssText = "position:absolute;inset:0;display:flex;width:100%;height:100%;min-height:0;min-width:0;overflow:hidden;touch-action:pan-y pinch-zoom";

    function setControlsVisible(visible) {
      if (closed) return;
      clearTimeout(controlsTimer);
      controlsVisible = visible;
      if (!visible && (toolbar.contains(document.activeElement) || frames.some((frame) => frame.mode === document.activeElement))) spread.focus({ preventScroll: true });
      toolbar.hidden = !visible;
      toolbar.inert = !visible;
      toolbar.style.display = visible ? "flex" : "none";
      for (const frame of frames) frame.mode.style.display = visible && frame.entry ? "inline-flex" : "none";
      if (visible) controlsTimer = setTimeout(() => setControlsVisible(false), 3000);
    }
    toolbar.addEventListener("touchstart", () => setControlsVisible(true), { passive: true });
    toolbar.addEventListener("pointerdown", () => setControlsVisible(true), { passive: true });
    toolbar.addEventListener("keydown", () => setControlsVisible(true));
    const frames = [0, 1].map(() => {
      const element = document.createElement("section");
      element.dataset.tokiPage = "";
      // Normal pages use half the width; combined/manual single images use all
      // of it. Neither layout crops or stacks the original images.
      element.style.cssText = "position:relative;flex:0 0 50%;width:50%;height:100%;min-width:0;min-height:0;overflow:hidden;box-sizing:border-box";
      const message = document.createElement("div");
      message.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:8px;text-align:center;box-sizing:border-box;color:white";
      const text = document.createElement("span");
      const frame = { element, message, text, image: null, entry: null, src: null };
      frame.mode = makeButton("", () => {
        const entry = frame.entry;
        const key = imageKey(entry);
        if (!key) return;
        singleOverrides.set(key, !isSingle(entry));
        start = snapshot.entries.findIndex((item) => item.key === entry.key);
        draw();
        const target = frames.find((item) => item.entry?.key === entry.key);
        target?.mode.focus({ preventScroll: true });
        setControlsVisible(true);
      }, report);
      frame.mode.dataset.tokiPageMode = "";
      const retry = makeButton("다시 시도", () => loadFrame(frame, frame.entry, true), report);
      frame.retry = retry;
      message.append(text, retry);
      element.append(message, frame.mode);
      spread.append(element);
      return frame;
    });
    dialog.append(menuStyle, toolbar, notice, spread);

    function imageKey(entry) {
      return entry?.page?.src ? JSON.stringify([entry.key, entry.page.src, entry.page.referrerPolicy]) : null;
    }

    function classify(image) {
      return image?.naturalWidth > 0 && image.naturalHeight > 0
        ? image.naturalWidth / image.naturalHeight >= SPREAD_RATIO : null;
    }

    function isSingle(entry) {
      const key = imageKey(entry);
      if (!key) return false;
      if (singleOverrides.has(key)) return singleOverrides.get(key);
      if (!pageTypes.has(key)) {
        const image = entry.image;
        // Lazy placeholders and an old source's dimensions are not evidence.
        if (image?.complete && normalizeUrl(image.currentSrc || image.getAttribute("src")) === entry.page.src) {
          const type = classify(image);
          if (type !== null) pageTypes.set(key, type);
        }
      }
      return pageTypes.get(key) === true;
    }

    function getStarts(entries = snapshot.current ? snapshot.entries : []) {
      return spreadStarts(entries.length, cover, (index) => isSingle(entries[index]));
    }

    function pagesAt(entries, starts, pageStart) {
      return entries.slice(pageStart, starts[starts.indexOf(pageStart) + 1] ?? entries.length);
    }

    function sourceLoaded(event) {
      if (snapshot.entries.some((entry) => entry.image === event.target)) draw();
    }

    function releaseImage(record) {
      record.image.removeEventListener("load", record.onLoad);
      record.image.removeEventListener("error", record.onError);
      record.listeners.clear();
      // Removing src releases our reference to a pending request; cancellation is
      // browser-controlled. Do not stop unrelated page loads with window.stop().
      record.image.removeAttribute("src");
    }

    function cachedImage(entry, preload = false, force = false) {
      const key = imageKey(entry);
      let record = imageCache.get(key);
      if (record && force) { releaseImage(record); imageCache.delete(key); record = null; }
      if (!record) {
        const image = new Image();
        record = { image, status: "loading", listeners: new Set() };
        const notify = (status) => {
          record.status = status;
          for (const listener of record.listeners) listener();
        };
        record.onLoad = () => {
          const before = isSingle(entry);
          const type = classify(image);
          if (type !== null) pageTypes.set(key, type);
          notify("complete");
          if (before !== isSingle(entry)) draw();
        };
        record.onError = () => notify("error");
        image.addEventListener("load", record.onLoad);
        image.addEventListener("error", record.onError);
        image.alt = entry.page.alt || `${entry.key}쪽`;
        image.loading = "eager";
        image.decoding = "async";
        image.referrerPolicy = entry.page.referrerPolicy;
        image.fetchPriority = preload ? "low" : "high";
        imageCache.set(key, record);
        image.src = entry.page.src;
      } else if (!preload) record.image.fetchPriority = "high";
      return record;
    }

    function preloadNext(entries, starts) {
      const position = starts.indexOf(start);
      const keep = new Set();
      // Retain the previous spread for back navigation, but only request the
      // current and next spreads. At most six page images are retained.
      for (const offset of [-1, 0, 1]) {
        const pageStart = starts[position + offset];
        if (pageStart === undefined) continue;
        for (const entry of pagesAt(entries, starts, pageStart)) {
          const key = imageKey(entry);
          if (!key) continue;
          keep.add(key);
          if (offset === 1) cachedImage(entry, true);
        }
      }
      for (const [key, record] of imageCache) {
        if (!keep.has(key)) { releaseImage(record); imageCache.delete(key); }
      }
    }

    function loadFrame(frame, entry, force = false) {
      const src = entry?.page?.src || null;
      if (!force && frame.initialized && frame.entry?.key === entry?.key && frame.src === src) {
        frame.entry = entry;
        if (entry && !src) frame.text.textContent = `${entry.key}쪽: ${entry.siteError ? "원본 이미지 로딩 실패" : "이미지 준비 중"}`;
        return;
      }
      frame.initialized = true;
      frame.unsubscribe?.();
      // A pairing change may already have moved this cached image to its other
      // frame. Never remove it from the new frame while clearing the old one.
      if (frame.image?.parentElement === frame.element) frame.image.remove();
      frame.image = null;
      frame.entry = entry;
      frame.src = src;
      frame.element.dataset.tokiPage = entry?.key || "";
      frame.element.style.visibility = entry ? "visible" : "hidden";
      frame.message.style.display = "flex";
      frame.retry.hidden = true;
      if (!entry) return;
      frame.text.textContent = src ? `${entry.key}쪽 불러오는 중…`
        : `${entry.key}쪽: ${entry.siteError ? "원본 이미지 로딩 실패" : "이미지 준비 중"}`;
      if (!src) return;
      const old = imageCache.get(imageKey(entry));
      const record = cachedImage(entry, false, force || old?.status === "error");
      const image = record.image;
      frame.image = image;
      image.style.cssText = "display:block;position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:contain;user-select:none";
      image.style.objectPosition = (frames.indexOf(frame) === 0) === rtl ? "left center" : "right center";
      image.draggable = false;
      const update = () => {
        if (closed || frame.image !== image) return;
        frame.message.style.display = record.status === "complete" ? "none" : "flex";
        frame.retry.hidden = record.status !== "error";
        if (record.status === "error") frame.text.textContent = `${entry.key}쪽을 불러오지 못했습니다.`;
      };
      record.listeners.add(update);
      frame.unsubscribe = () => record.listeners.delete(update);
      frame.element.prepend(image);
      update();
    }

    function draw() {
      if (closed) return;
      const entries = snapshot.current ? snapshot.entries : [];
      const starts = getStarts(entries);
      // A late classification can shift pair boundaries. Keep the current
      // image in view instead of jumping to the end or skipping a source.
      if (!starts.includes(start)) start = [...starts].reverse().find((index) => index <= start) ?? 0;
      const pages = pagesAt(entries, starts, start);
      const fullWidth = pages.length === 1 && isSingle(pages[0]);
      count.textContent = pages.length ? `${start + 1}${pages.length > 1 ? `–${start + pages.length}` : ""} / ${entries.length}` : "이미지 준비 중";
      previous.disabled = start === 0;
      next.disabled = !starts.length || start === starts.at(-1);
      previousEpisode.disabled = !findEpisodeControl("previous");
      nextEpisode.disabled = !findEpisodeControl("next");
      pairing.setAttribute("aria-pressed", String(cover));
      setToolIcon(previous, "이전 2쪽", rtl ? "right" : "left");
      setToolIcon(next, "다음 2쪽", rtl ? "left" : "right");
      setToolIcon(previousEpisode, "이전화", rtl ? "episodeRight" : "episodeLeft");
      setToolIcon(nextEpisode, "다음화", rtl ? "episodeLeft" : "episodeRight");
      setToolIcon(direction, rtl ? "읽기: 우→좌" : "읽기: 좌→우", rtl ? "rtl" : "ltr");
      setToolIcon(pairing, "첫 장 단독", "cover");
      pager.style.flexDirection = rtl ? "row-reverse" : "row";
      spread.style.flexDirection = rtl ? "row-reverse" : "row";
      frames.forEach((frame, index) => {
        frame.element.style.flexBasis = fullWidth ? "100%" : "50%";
        frame.element.style.width = fullWidth ? "100%" : "50%";
        frame.element.style.display = fullWidth && index === 1 ? "none" : "block";
        loadFrame(frame, pages[index]);
        if (frame.image) frame.image.style.objectPosition = fullWidth ? "center" : (index === 0) === rtl ? "left center" : "right center";
        const single = isSingle(frame.entry);
        frame.mode.disabled = !frame.entry?.page;
        frame.mode.setAttribute("aria-pressed", String(single));
        setToolIcon(frame.mode, `${frame.entry?.key || ""}쪽 ${single ? "두 쪽에 묶기" : "단독 보기"}`, single ? "paired" : "single");
        Object.assign(frame.mode.style, {
          position: "absolute", top: "12px", right: "12px", zIndex: "1",
          background: "rgba(20,24,32,.85)",
          display: controlsVisible && frame.entry ? "inline-flex" : "none",
        });
      });
      preloadNext(entries, starts);
    }

    function move(delta) {
      const starts = getStarts();
      const index = starts.indexOf(start);
      start = starts[Math.max(0, Math.min(starts.length - 1, index + delta))] ?? 0;
      draw();
    }

    function changeEpisode(direction) {
      const control = findEpisodeControl(direction);
      if (!control) { draw(); return; }
      const href = control.getAttribute("href");
      const destination = href ? routeKey(new URL(href, document.baseURI).href) : null;
      onEpisodeNavigation();
      try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify({ from: routeKey(), destination, time: Date.now() }));
      } catch (_) { /* Navigation still works if storage is unavailable. */ }
      close();
      control.click();
    }

    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(controlsTimer);
      for (const frame of frames) frame.unsubscribe?.();
      for (const record of imageCache.values()) releaseImage(record);
      imageCache.clear();
      pageTypes.clear();
      singleOverrides.clear();
      if (ownsFullscreen && document.fullscreenElement === document.documentElement) {
        Promise.resolve(document.exitFullscreen()).catch(console.error);
      }
      try { if (dialog.open && typeof dialog.close === "function") dialog.close(); }
      finally {
        dialog.remove();
        if (overflow) htmlStyle.setProperty("overflow", overflow, overflowPriority);
        else htmlStyle.removeProperty("overflow");
        removeEventListener("keydown", keydown, true);
        document.removeEventListener("fullscreenchange", updateFullscreenButton);
        document.removeEventListener("load", sourceLoaded, true);
        if (focusBefore?.isConnected) focusBefore.focus?.({ preventScroll: true });
        onClose();
      }
    }

    function keydown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isTyping(event)) return;
      const key = event.key.toLowerCase();
      let action;
      if (key === "escape" || key === "i") action = close;
      if (["j", "pagedown", "arrowdown"].includes(key)) action = () => move(1);
      if (["k", "pageup", "arrowup"].includes(key)) action = () => move(-1);
      if (key === "arrowleft") action = () => move(rtl ? 1 : -1);
      if (key === "arrowright") action = () => move(rtl ? -1 : 1);
      if (key === "l") action = () => changeEpisode("next");
      if (key === "h") action = () => changeEpisode("previous");
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      action();
    }

    let swipe = null;
    let lastTouchAction = -Infinity;
    spread.addEventListener("touchstart", (event) => {
      const point = event.touches.length === 1 && !event.target.closest("button") ? event.touches[0] : null;
      swipe = point ? { id: point.identifier, x: point.clientX, y: point.clientY, time: Date.now(), moved: false } : null;
    }, { passive: true });
    spread.addEventListener("touchmove", (event) => {
      const point = [...event.touches].find((point) => point.identifier === swipe?.id);
      if (point && Math.hypot(point.clientX - swipe.x, point.clientY - swipe.y) > 10) swipe.moved = true;
    }, { passive: true });
    spread.addEventListener("touchcancel", () => { swipe = null; }, { passive: true });
    spread.addEventListener("touchend", (event) => {
      const initial = swipe;
      swipe = null;
      const point = [...event.changedTouches].find((point) => point.identifier === initial?.id);
      if (!initial || !point || event.touches.length || (window.visualViewport?.scale ?? 1) > 1.05) return;
      const dx = point.clientX - initial.x;
      const dy = point.clientY - initial.y;
      if (!initial.moved && Math.hypot(dx, dy) < 10 && Date.now() - initial.time < 800) {
        event.preventDefault();
        event.stopPropagation();
        lastTouchAction = Date.now();
        setControlsVisible(!controlsVisible);
        return;
      }
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      event.preventDefault();
      event.stopPropagation();
      lastTouchAction = Date.now();
      const delta = (dx > 0) === rtl ? 1 : -1;
      const starts = getStarts();
      const position = starts.indexOf(start);
      if (position + delta < 0 || position + delta >= starts.length) {
        setControlsVisible(true);
      } else move(delta);
    }, { passive: false });
    spread.addEventListener("click", (event) => {
      if (event.target.closest("button") || Date.now() - lastTouchAction < 800) return;
      setControlsVisible(!controlsVisible);
    });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    document.body.append(dialog);
    try { dialog.showModal(); }
    catch (_) { dialog.setAttribute("open", ""); dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true"); }
    htmlStyle.setProperty("overflow", "hidden");
    addEventListener("keydown", keydown, true);
    document.addEventListener("fullscreenchange", updateFullscreenButton);
    document.addEventListener("load", sourceLoaded, true);
    updateFullscreenButton();
    closeButton.focus({ preventScroll: true });
    draw();
    setControlsVisible(true);
    // Manual entry is still in the original tap/key handler. Automatic chapter
    // resume has no fresh activation and leaves this option false.
    if (autoFullscreen && !document.fullscreenElement) void toggleFullscreen();
    return { close, update(value) { snapshot = value; draw(); } };
  }

  function isTyping(event) {
    const target = event.target;
    return target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "");
  }

  function start() {
    if (getOrigin() === "unknown" && !findImageArea() && !/뉴토끼|마나토끼|북토끼/.test(document.title)) return () => {};
    let guard = { route: routeKey(), blockedSources: new Map() };
    let ownedEntries = [];
    let departingEntries = null;
    let snapshot = collectSnapshot(guard);
    let viewer = null;
    let stopped = false;
    let queued = false;
    const panel = document.createElement("section");
    panel.dataset.tokiViewerUi = "";
    panel.style.cssText = "position:relative;z-index:2147483646;isolation:isolate;padding:10px;margin:8px 0;background:#222;color:white;border-radius:8px;font:14px/1.5 sans-serif";
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    const error = document.createElement("div");
    error.setAttribute("role", "alert");
    error.style.color = "#ffb5b5";
    const report = (reason) => {
      error.textContent = `열기 오류: ${reason?.message || String(reason)}`;
      console.error("[토끼 뷰어]", reason);
    };
    function openViewer() {
      error.textContent = "";
      refresh();
      if (viewer) return;
      if (!snapshot.current || !snapshot.entries.length) {
        error.textContent = "현재 회차의 이미지가 아직 준비되지 않았습니다.";
        return;
      }
      viewer = createSpreadViewer(snapshot, () => { viewer = null; }, true, () => checkpointEpisode(true));
    }
    const open = makeButton("두 쪽 보기", openViewer, report);
    panel.append(status, open, error);
    const shortcuts = new Map();
    function checkpointEpisode(force = false) {
      // Freeze ownership before the site's SPA handler can replace images while
      // the URL and scopePath still describe the departing episode.
      if (routeKey() !== guard.route || (departingEntries && !force)) return;
      const current = collectSnapshot(guard);
      departingEntries = current.current ? current.entries : ownedEntries;
    }
    function refresh() {
      if (stopped) return;
      if (routeKey() !== guard.route) {
        viewer?.close();
        guard = {
          route: routeKey(),
          blockedSources: new Map((departingEntries || ownedEntries).filter((entry) => entry.image && entry.rawSrc).map((entry) => [entry.image, entry.rawSrc])),
        };
        ownedEntries = [];
        departingEntries = null;
      }
      snapshot = collectSnapshot(guard);
      if (snapshot.current) ownedEntries = snapshot.entries;
      const message = `토끼 뷰어 ${VERSION} · ${snapshot.current ? `페이지 준비 ${snapshot.ready}/${snapshot.entries.length}` : "현재 회차 준비 중"}`;
      if (status.textContent !== message) status.textContent = message;
      open.disabled = !snapshot.current || !snapshot.entries.length;
      const navs = [...document.querySelectorAll(".theme-viewer-nav, .toon-nav")];
      if (!panel.isConnected) {
        if (navs[0]) navs[0].after(panel);
        else document.body.prepend(panel);
      }
      for (const [nav, button] of shortcuts) if (!nav.isConnected) { button.remove(); shortcuts.delete(nav); }
      for (const nav of navs.slice(1)) {
        if (!shortcuts.has(nav)) {
          const button = makeButton("두 쪽 보기", openViewer, report);
          button.dataset.tokiViewerUi = "";
          button.style.position = "relative";
          button.style.zIndex = "2147483646";
          nav.prepend(button);
          shortcuts.set(nav, button);
        }
        shortcuts.get(nav).disabled = open.disabled;
      }
      viewer?.update(snapshot);
      if (!viewer && snapshot.current && snapshot.entries.length) {
        let resume;
        try {
          const raw = sessionStorage.getItem(RESUME_KEY);
          resume = raw ? JSON.parse(raw) : null;
          if (resume && (!Number.isFinite(resume.time) || Date.now() - resume.time > 60000)) {
            sessionStorage.removeItem(RESUME_KEY);
            resume = null;
          }
          if (resume && (resume.destination ? resume.destination === guard.route : resume.from !== guard.route)) {
            sessionStorage.removeItem(RESUME_KEY);
          } else resume = null;
        } catch (_) { resume = null; }
        if (resume) {
          try { viewer = createSpreadViewer(snapshot, () => { viewer = null; }, false, () => checkpointEpisode(true)); }
          catch (reason) { report(reason); }
        }
      }
    }
    const schedule = () => {
      if (stopped || queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; refresh(); });
    };
    const disconnect = observeSource(schedule);
    const onNavigate = () => { if (routeKey() !== guard.route) refresh(); };
    const navigation = window.navigation;
    const onNavigationStart = (event) => {
      if (event.destination?.url && routeKey(event.destination.url) !== guard.route) {
        checkpointEpisode();
        const entries = departingEntries;
        event.signal?.addEventListener("abort", () => {
          if (departingEntries === entries) departingEntries = null;
        }, { once: true });
      }
    };
    const onEpisodeClick = (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target.closest?.("a, button, .vw-act, #goPrevBtn, #goNextBtn");
      if (!target || (target.tagName === "A" && ((target.target && target.target !== "_self") || target.hasAttribute("download")))) return;
      if (findEpisodeControl("previous", target) || findEpisodeControl("next", target)) {
        checkpointEpisode(true);
      } else if (target.tagName === "A") {
        // Some themes give only the floating arrows a direction class. Their
        // toolbar links share the destination but have generic button classes.
        const matches = ["previous", "next"].some((direction) => {
          const control = findEpisodeControl(direction);
          return control?.tagName === "A" && control.href === target.href;
        });
        if (matches) checkpointEpisode(true);
      }
    };
    const timer = navigation ? null : setInterval(onNavigate, 500);
    navigation?.addEventListener("navigate", onNavigationStart);
    navigation?.addEventListener("navigatesuccess", onNavigate);
    document.addEventListener("click", onEpisodeClick, true);
    const onKey = (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || isTyping(event)) return;
      if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        if (viewer) viewer.close();
        else { try { openViewer(); } catch (reason) { report(reason); } }
      }
    };
    addEventListener("keydown", onKey);
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      viewer?.close();
      disconnect();
      clearInterval(timer);
      navigation?.removeEventListener("navigate", onNavigationStart);
      navigation?.removeEventListener("navigatesuccess", onNavigate);
      document.removeEventListener("click", onEpisodeClick, true);
      removeEventListener("keydown", onKey);
      removeEventListener("pagehide", onHide);
      panel.remove();
      for (const button of shortcuts.values()) button.remove();
    };
    const onHide = (event) => { if (!event.persisted) cleanup(); };
    addEventListener("pagehide", onHide);
    refresh();
    return cleanup;
  }

  start();
})();
