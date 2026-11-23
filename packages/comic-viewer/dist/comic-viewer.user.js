// ==UserScript==
// @name         토끼 뷰어 (새 테마 호환 수정본)
// @namespace    https://greasyfork.org/ko/users/713014-nanikit
// @version      261123000006
// @author       nanikit (original), compatibility patch
// @description  두 쪽 보기. i: 열기/닫기, j/k: 다음/이전 두 쪽.
// @downloadURL  https://raw.githubusercontent.com/wkair/tampermonkey-scripts/main/packages/comic-viewer/dist/comic-viewer.user.js
// @updateURL    https://raw.githubusercontent.com/wkair/tampermonkey-scripts/main/packages/comic-viewer/dist/comic-viewer.user.js
// @match        https://*.com/bbs/*
// @match        https://*.com/end/*
// @match        https://*.com/manhwa-end/*
// @match        https://*.com/manhwa/*
// @match        https://*.org/manhwa-end/*
// @match        https://*.org/manhwa/*
// @match        https://*.com/novel/*
// @match        https://*.com/webtoon/*
// @match        https://*.org/webtoon/*
// @match        https://*.net/bbs/*
// @match        https://*.net/comic/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function() {
	"use strict";
	(() => {
		const VERSION = "261123000006";
		const SPREAD_RATIO = 1.2;
		const RESUME_KEY = "toki-viewer.resume-episode";
		const COVER_KEY = "toki-viewer.first-page-alone";
		const FIT_KEY = "toki-viewer.image-fit";
		const DIRECTION_KEY = "toki-viewer.reading-direction";
		const FIT_MODES = [
			{
				value: "contain",
				label: "화면 맞춤"
			},
			{
				value: "height",
				label: "높이 맞춤"
			},
			{
				value: "width",
				label: "폭 맞춤"
			}
		];
		let coverPreference = false;
		let fitPreference = "contain";
		let directionPreference = null;
		try {
			coverPreference = localStorage.getItem(COVER_KEY) === "true";
			const fit = localStorage.getItem(FIT_KEY);
			if (FIT_MODES.some((mode) => mode.value === fit)) fitPreference = fit;
			const direction = localStorage.getItem(DIRECTION_KEY);
			if (direction === "rtl" || direction === "ltr") directionPreference = direction;
		} catch (_) {}
		const layouts = [
			{
				root: "[data-theme-viewer-images], .theme-viewer-images",
				theme: true
			},
			{
				root: ".vw-imgs",
				theme: false
			},
			{
				root: "div.view-padding",
				theme: false
			}
		];
		function findImageArea() {
			for (const layout of layouts) {
				const root = document.querySelector(layout.root);
				if (root) return {
					root,
					theme: layout.theme
				};
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
			const src = [
				image.getAttribute("data-src"),
				image.getAttribute("data-original"),
				image.getAttribute("data-lazy-src"),
				...Object.values(image.dataset).map((value) => normalizeUrl(value, false)),
				image.getAttribute("src")
			].map((value) => normalizeUrl(value)).find(Boolean);
			if (!src) return null;
			return {
				src,
				alt: image.alt || "",
				referrerPolicy: theme ? "no-referrer" : image.referrerPolicy || ""
			};
		}
		function routeKey(url = location.href) {
			const parsed = new URL(url, document.baseURI);
			return parsed.pathname.replace(/\/$/, "") + (/^\/(manhwa|webtoon)\/[^/]+\/[^/]+\/?$/.test(parsed.pathname) ? "" : parsed.search);
		}
		function collectSnapshot(guard) {
			const area = findImageArea();
			const empty = {
				entries: [],
				ready: 0,
				current: false
			};
			if (!area) return empty;
			const dataElement = area.theme && document.getElementById("theme-viewer-data");
			let config = null;
			if (dataElement) try {
				config = JSON.parse(dataElement.textContent);
			} catch (_) {
				return empty;
			}
			const scope = config?.scopePath;
			const current = routeKey() === guard.route && (!scope || routeKey(scope) === guard.route);
			const slots = area.theme ? [...area.root.querySelectorAll("[data-theme-page]")] : [];
			let entries;
			if (slots.length || Array.isArray(config?.images)) {
				const slotMap = new Map(slots.map((slot) => [slot.dataset.themePage, slot]));
				const keys = Array.isArray(config?.images) && config.images.length ? config.images.map((meta) => String(meta.page)) : slots.map((slot) => slot.dataset.themePage);
				entries = [...new Set(keys)].map((key) => {
					const slot = slotMap.get(key);
					const img = slot?.querySelector("img");
					return {
						key,
						image: img,
						page: img ? readPage(img, true) : null,
						siteError: !!slot?.classList.contains("is-error")
					};
				});
			} else entries = [...area.root.querySelectorAll("img")].filter((img) => area.theme || img.offsetParent !== null).map((img, index) => ({
				key: String(index + 1),
				image: img,
				page: readPage(img, area.theme),
				siteError: false
			}));
			entries = entries.map((entry) => ({
				...entry,
				rawSrc: entry.page?.src,
				page: current && (!entry.page || guard.blockedSources.get(entry.image) !== entry.page.src) ? entry.page : null
			}));
			return {
				entries,
				ready: entries.filter((entry) => entry.page).length,
				current
			};
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
					return record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1 && (node.matches(added) || node.querySelector(added)));
				})) callback();
			});
			observer.observe(document.documentElement, {
				subtree: true,
				childList: true,
				attributes: true,
				characterData: true
			});
			return () => observer.disconnect();
		}
		function bindAction(element, action, onError = console.error) {
			let touch = null;
			let lastTouch = -Infinity;
			const invoke = () => {
				if (element.disabled) return;
				try {
					Promise.resolve(action()).catch(onError);
				} catch (error) {
					onError(error);
				}
			};
			element.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (event.detail > 0 && Date.now() - lastTouch < 800) return;
				invoke();
			}, { capture: true });
			element.addEventListener("touchstart", (event) => {
				const point = event.touches.length === 1 ? event.touches[0] : null;
				touch = point ? {
					id: point.identifier,
					x: point.clientX,
					y: point.clientY,
					time: Date.now()
				} : null;
			}, { passive: true });
			element.addEventListener("touchmove", (event) => {
				const point = [...event.touches].find((point) => point.identifier === touch?.id);
				if (!point || Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > 10) touch = null;
			}, { passive: true });
			element.addEventListener("touchcancel", () => {
				touch = null;
			}, { passive: true });
			element.addEventListener("touchend", (event) => {
				const start = touch;
				touch = null;
				const point = [...event.changedTouches].find((point) => point.identifier === start?.id);
				if (!start || !point || event.touches.length || Date.now() - start.time > 800 || Math.hypot(point.clientX - start.x, point.clientY - start.y) > 10) return;
				lastTouch = Date.now();
				event.preventDefault();
				event.stopPropagation();
				invoke();
			}, {
				passive: false,
				capture: true
			});
		}
		function findEpisodeControl(direction, candidate = null) {
			const selectors = direction === "previous" ? [
				"a.theme-viewer-prev[href]",
				".vw-act[aria-label='이전화']",
				"#goPrevBtn"
			] : [
				"a.theme-viewer-next[href]",
				".vw-act[aria-label='다음화']",
				"#goNextBtn"
			];
			for (const selector of selectors) {
				const buttons = candidate ? candidate.matches(selector) ? [candidate] : [] : document.querySelectorAll(selector);
				for (const button of buttons) {
					if (button.disabled || button.getAttribute("aria-disabled") === "true" || button.classList.contains("disabled")) continue;
					if (button.tagName === "A") {
						const href = button.getAttribute("href");
						if (!href || href.startsWith("#")) continue;
						try {
							const url = new URL(href, document.baseURI);
							if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin || routeKey(url.href) === routeKey()) continue;
						} catch (_) {
							continue;
						}
					}
					return button;
				}
			}
			return null;
		}
		function getOrigin() {
			return [
				"manatoki",
				"newtoki",
				"booktoki"
			].find((name) => location.hostname.includes(name)) || "unknown";
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
				i += cover && i === 0 || single(i) || single(i + 1) ? 1 : 2;
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
				expand: ["M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"],
				collapse: ["M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"],
				close: ["m6 6 12 12M18 6 6 18"]
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
			let fit = fitPreference;
			let rtl = directionPreference ? directionPreference === "rtl" : getOrigin() === "manatoki" || /^\/manhwa(?:-end)?\//.test(location.pathname);
			let closed = false;
			let ownsFullscreen = false;
			let fullscreenPending = false;
			let controlsVisible = true;
			let controlsTimer;
			let zoom = 1;
			let panX = 0;
			let panY = 0;
			let viewKey = "";
			let pressTimer;
			let tapTimer;
			let press = null;
			let longPressConsumed = false;
			let pageMenu = null;
			const imageCache = new Map();
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
			toolbar.style.cssText = "position:absolute;left:50%;bottom:calc(max(6px,env(safe-area-inset-bottom)) + 26px);transform:translateX(-50%);z-index:2;box-sizing:border-box;width:max-content;max-width:calc(100% - 24px);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px;padding:7px;border:1px solid #ffffff24;border-radius:22px;background:rgba(20,24,32,.9);backdrop-filter:blur(20px);box-shadow:0 8px 32px #0006,0 1px 0 #ffffff0d inset";
			const versionLabel = document.createElement("div");
			versionLabel.dataset.tokiVersion = "";
			versionLabel.textContent = `v${VERSION}`;
			versionLabel.setAttribute("aria-label", `뷰어 버전 ${VERSION}`);
			versionLabel.style.cssText = "position:absolute;right:max(12px,env(safe-area-inset-right));bottom:max(6px,env(safe-area-inset-bottom));z-index:2;padding:2px 6px;border-radius:5px;background:rgba(20,24,32,.85);color:#c7ced9;font:12px/1.4 system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;user-select:none";
			const menuStyle = document.createElement("style");
			menuStyle.textContent = "[data-toki-toolbar] button:disabled{opacity:.28;cursor:default}[data-toki-toolbar] button:focus-visible{outline:2px solid #a8caff;outline-offset:1px}@media(hover:hover){[data-toki-toolbar] button:not(:disabled):hover{background:#ffffff18!important}}";
			const count = document.createElement("span");
			count.dataset.tokiPageCount = "";
			count.setAttribute("role", "status");
			count.style.cssText = "min-width:98px;text-align:center;color:#f0f3fa;font:500 14px/1.4 system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.3px;white-space:nowrap";
			const notice = document.createElement("div");
			notice.setAttribute("role", "status");
			notice.style.cssText = "position:absolute;inset:0 0 auto;z-index:3;max-height:30%;overflow:auto;background:#222e;color:#ffcece;text-align:center";
			const report = (error) => {
				notice.textContent = `실행 오류: ${error?.message || String(error)}`;
				console.error("[토끼 뷰어]", error);
			};
			const previous = makeButton("이전 2쪽", () => move(-1), report);
			const next = makeButton("다음 2쪽", () => move(1), report);
			const previousEpisode = makeButton("이전화", () => changeEpisode("previous"), report);
			const nextEpisode = makeButton("다음화", () => changeEpisode("next"), report);
			const direction = makeButton("", () => {
				rtl = !rtl;
				directionPreference = rtl ? "rtl" : "ltr";
				try {
					localStorage.setItem(DIRECTION_KEY, directionPreference);
				} catch (_) {}
				draw();
			}, report);
			const fitButton = makeButton("", () => {
				const index = FIT_MODES.findIndex((mode) => mode.value === fit);
				fit = FIT_MODES[(index + 1) % FIT_MODES.length].value;
				fitPreference = fit;
				try {
					localStorage.setItem(FIT_KEY, fit);
				} catch (_) {}
				draw();
			}, report);
			fitButton.dataset.tokiFit = "";
			fitButton.style.cssText = "flex:none;height:44px;min-height:44px;min-width:80px;padding:0 8px;border:1px solid #ffffff24;border-radius:12px;background:#ffffff0d;color:#e5eaf3;font:500 13px system-ui,sans-serif;white-space:nowrap;touch-action:manipulation;cursor:pointer";
			const pairing = makeButton("첫 장 단독", () => {
				cover = !cover;
				coverPreference = cover;
				try {
					localStorage.setItem(COVER_KEY, String(cover));
				} catch (_) {}
				start = [...getStarts()].reverse().find((index) => index <= start) ?? 0;
				draw();
			}, report);
			const closeButton = makeButton("닫기", close, report);
			const fullscreenButton = makeButton("전체화면", toggleFullscreen, report);
			const pager = document.createElement("div");
			pager.style.cssText = "display:flex;align-items:center;gap:0";
			pager.append(previousEpisode, previous, count, next, nextEpisode);
			const tools = document.createElement("div");
			tools.style.cssText = "display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:2px;max-width:100%";
			tools.append(fitButton, direction, pairing, fullscreenButton, closeButton);
			toolbar.append(pager, tools);
			setToolIcon(closeButton, "닫기", "close");
			function updateFullscreenButton(event) {
				if (!closed && event?.type === "fullscreenchange" && document.fullscreenElement === document.documentElement && dialog.open && typeof dialog.close === "function" && typeof dialog.showModal === "function") try {
					dialog.close();
					dialog.showModal();
				} catch (_) {
					dialog.setAttribute("open", "");
				}
				fullscreenButton.disabled = fullscreenPending;
				fullscreenButton.setAttribute("aria-pressed", String(!!document.fullscreenElement));
				setToolIcon(fullscreenButton, document.fullscreenElement ? "전체화면 해제" : "전체화면", document.fullscreenElement ? "collapse" : "expand");
				if (document.fullscreenElement !== document.documentElement) ownsFullscreen = false;
			}
			function toggleFullscreen() {
				if (closed || fullscreenPending) return;
				notice.textContent = "";
				if (document.fullscreenElement) return document.exitFullscreen().catch(report);
				if (typeof document.documentElement.requestFullscreen !== "function" || document.fullscreenEnabled === false) {
					notice.textContent = "이 환경에서는 전체화면을 사용할 수 없습니다.";
					return;
				}
				fullscreenPending = true;
				fullscreenButton.disabled = true;
				ownsFullscreen = true;
				let request;
				try {
					request = document.documentElement.requestFullscreen({ navigationUI: "hide" });
				} catch (error) {
					request = Promise.reject(error);
				}
				return Promise.resolve(request).then(() => {
					if (closed && document.fullscreenElement === document.documentElement) return document.exitFullscreen();
					if (!closed && document.fullscreenElement === document.documentElement) setControlsVisible(false);
				}).catch((error) => {
					ownsFullscreen = false;
					if (!closed) notice.textContent = `전체화면 요청이 거절됐습니다. 다시 눌러주세요. (${error?.message || String(error)})`;
				}).finally(() => {
					fullscreenPending = false;
					updateFullscreenButton();
				});
			}
			const viewport = document.createElement("div");
			viewport.dataset.tokiViewport = "";
			viewport.style.cssText = "position:absolute;inset:0;overflow:hidden;touch-action:none";
			const spread = document.createElement("div");
			spread.dataset.tokiSpread = "";
			spread.tabIndex = -1;
			spread.style.cssText = "position:absolute;inset:0;display:flex;width:100%;height:100%;min-height:0;min-width:0;overflow:hidden;transform-origin:center;touch-action:none";
			function applyZoom() {
				const bounds = viewport.getBoundingClientRect();
				const limitX = bounds.width * (zoom - 1) / 2;
				const limitY = bounds.height * (zoom - 1) / 2;
				panX = Math.max(-limitX, Math.min(limitX, panX));
				panY = Math.max(-limitY, Math.min(limitY, panY));
				spread.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
				spread.style.cursor = zoom > 1 ? "grab" : "";
			}
			function resetZoom() {
				zoom = 1;
				panX = panY = 0;
				applyZoom();
			}
			function resizeViewer() {
				cancelPendingActions();
				for (const frame of frames) if (frame.image) styleImage(frame.image, frame);
				applyZoom();
			}
			function setControlsVisible(visible) {
				if (closed) return;
				clearTimeout(controlsTimer);
				controlsVisible = visible;
				if (!visible && toolbar.contains(document.activeElement)) spread.focus({ preventScroll: true });
				toolbar.hidden = !visible;
				toolbar.inert = !visible;
				toolbar.style.display = visible ? "flex" : "none";
				versionLabel.hidden = !visible;
				versionLabel.style.display = visible ? "block" : "none";
				if (visible) controlsTimer = setTimeout(() => setControlsVisible(false), 3e3);
			}
			toolbar.addEventListener("touchstart", () => setControlsVisible(true), { passive: true });
			toolbar.addEventListener("pointerdown", () => setControlsVisible(true), { passive: true });
			toolbar.addEventListener("keydown", () => setControlsVisible(true));
			const frames = [0, 1].map(() => {
				const element = document.createElement("section");
				element.dataset.tokiPage = "";
				element.style.cssText = "position:relative;flex:0 0 50%;width:50%;height:100%;min-width:0;min-height:0;overflow:hidden;box-sizing:border-box";
				const message = document.createElement("div");
				message.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:8px;text-align:center;box-sizing:border-box;color:white";
				const text = document.createElement("span");
				const frame = {
					element,
					message,
					text,
					image: null,
					entry: null,
					src: null
				};
				const retry = makeButton("다시 시도", () => loadFrame(frame, frame.entry, true), report);
				frame.retry = retry;
				message.append(text, retry);
				element.append(message);
				spread.append(element);
				return frame;
			});
			viewport.append(spread);
			dialog.append(menuStyle, toolbar, versionLabel, notice, viewport);
			function cancelPress() {
				clearTimeout(pressTimer);
				press = null;
			}
			function cancelTap() {
				clearTimeout(tapTimer);
				lastTap = null;
			}
			function cancelPendingActions() {
				cancelPress();
				cancelTap();
			}
			function handleTap(x) {
				const bounds = viewport.getBoundingClientRect();
				const position = bounds.width ? (x - bounds.left) / bounds.width : .5;
				if (zoom > 1 || position >= .4 && position <= .6) setControlsVisible(!controlsVisible);
				else navigateGesture(position < .4 ? rtl ? 1 : -1 : rtl ? -1 : 1);
			}
			function frameAt(target) {
				const element = target.closest?.("[data-toki-page]");
				return frames.find((frame) => frame.element === element && frame.entry?.page);
			}
			function dismissPageMenu(restoreFocus = true) {
				if (!pageMenu) return;
				const previousMenu = pageMenu;
				pageMenu = null;
				longPressConsumed = false;
				lastTouchAction = Date.now();
				previousMenu.overlay.remove();
				viewport.inert = false;
				setControlsVisible(previousMenu.controlsVisible);
				if (restoreFocus && !closed) previousMenu.frame.element.focus({ preventScroll: true });
			}
			function openPageMenu(frame) {
				cancelPendingActions();
				const entry = frame?.entry;
				const key = imageKey(entry);
				if (closed || pageMenu || !key) return;
				const overlay = document.createElement("div");
				overlay.dataset.tokiPagePopup = "";
				overlay.style.cssText = "position:absolute;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:#0008;touch-action:none";
				const panel = document.createElement("section");
				panel.setAttribute("role", "dialog");
				panel.setAttribute("aria-modal", "true");
				panel.setAttribute("aria-label", `${entry.key}쪽 보기 설정`);
				panel.style.cssText = "position:relative;z-index:1;width:280px;max-width:100%;max-height:100%;overflow:auto;box-sizing:border-box;padding:20px;display:flex;flex-direction:column;gap:12px;border:1px solid #ffffff30;border-radius:18px;background:#191f29;color:#e5eaf3;box-shadow:0 16px 48px #0008";
				const heading = document.createElement("strong");
				heading.textContent = `${entry.key}쪽 보기 설정`;
				heading.style.cssText = "font:600 17px/1.5 system-ui,sans-serif";
				const single = isSingle(entry);
				const toggle = makeButton(`${entry.key}쪽 ${single ? "두 쪽에 묶기" : "단독 보기"}`, () => {
					if (pageMenu?.toggle !== toggle) return;
					if (imageKey(frame.entry) !== key) {
						dismissPageMenu();
						return;
					}
					singleOverrides.set(key, !isSingle(frame.entry));
					start = snapshot.entries.findIndex((item) => item.key === entry.key);
					dismissPageMenu();
					draw();
					frames.find((item) => item.entry?.key === entry.key)?.element.focus({ preventScroll: true });
				}, report);
				toggle.setAttribute("aria-pressed", String(single));
				toggle.style.cssText += ";background:#b9d2ff;color:#14243c;border:0;font-weight:600";
				const cancel = makeButton("취소", () => dismissPageMenu(), report);
				cancel.style.cssText += ";background:transparent;color:#e5eaf3;border-color:#ffffff30";
				const backdrop = makeButton("", () => dismissPageMenu(), report);
				backdrop.setAttribute("aria-label", "보기 설정 닫기");
				backdrop.tabIndex = -1;
				backdrop.dataset.tokiPopupBackdrop = "";
				backdrop.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;padding:0;background:transparent;touch-action:none";
				panel.append(heading, toggle, cancel);
				overlay.append(backdrop, panel);
				pageMenu = {
					overlay,
					frame,
					key,
					toggle,
					cancel,
					controlsVisible
				};
				setControlsVisible(false);
				viewport.inert = true;
				dialog.append(overlay);
				toggle.focus({ preventScroll: true });
			}
			function armPress(target, x, y) {
				cancelPress();
				const frame = frameAt(target);
				if (!frame || target.closest("button") || pageMenu) return;
				press = {
					x,
					y,
					frame,
					key: imageKey(frame.entry)
				};
				const pending = press;
				pressTimer = setTimeout(() => {
					if (press !== pending || imageKey(frame.entry) !== pending.key || closed) return;
					longPressConsumed = true;
					lastTouchAction = Date.now();
					swipe = pinch = mousePan = null;
					openPageMenu(frame);
				}, 550);
			}
			function movePress(x, y) {
				if (press && Math.hypot(x - press.x, y - press.y) > 10) cancelPress();
			}
			function imageKey(entry) {
				return entry?.page?.src ? JSON.stringify([
					entry.key,
					entry.page.src,
					entry.page.referrerPolicy
				]) : null;
			}
			function classify(image) {
				return image?.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight >= SPREAD_RATIO : null;
			}
			function isSingle(entry) {
				const key = imageKey(entry);
				if (!key) return false;
				if (singleOverrides.has(key)) return singleOverrides.get(key);
				if (!pageTypes.has(key)) {
					const image = entry.image;
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
				record.image.removeAttribute("src");
			}
			function cachedImage(entry, preload = false, force = false) {
				const key = imageKey(entry);
				let record = imageCache.get(key);
				if (record && force) {
					releaseImage(record);
					imageCache.delete(key);
					record = null;
				}
				if (!record) {
					const image = new Image();
					record = {
						image,
						status: "loading",
						listeners: new Set()
					};
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
				for (const offset of [
					-1,
					0,
					1
				]) {
					const pageStart = starts[position + offset];
					if (pageStart === void 0) continue;
					for (const entry of pagesAt(entries, starts, pageStart)) {
						const key = imageKey(entry);
						if (!key) continue;
						keep.add(key);
						if (offset === 1) cachedImage(entry, true);
					}
				}
				for (const [key, record] of imageCache) if (!keep.has(key)) {
					releaseImage(record);
					imageCache.delete(key);
				}
			}
			function styleImage(image, frame) {
				image.style.cssText = "display:block;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:100%;height:100%;min-width:0;min-height:0;max-width:none;max-height:none;object-fit:contain;object-position:center;user-select:none";
				const paired = frame.element.style.width !== "100%";
				const onLeft = frames.indexOf(frame) === 0 !== (spread.style.flexDirection === "row-reverse");
				if (paired) image.style.objectPosition = onLeft ? "right center" : "left center";
				if (fit === "height") {
					image.style.width = "auto";
					if (paired) {
						const anchorLeft = image.naturalHeight > 0 && image.naturalWidth / image.naturalHeight * frame.element.clientHeight > frame.element.clientWidth ? onLeft : !onLeft;
						image.style.left = anchorLeft ? "0" : "auto";
						image.style.right = anchorLeft ? "auto" : "0";
						image.style.transform = "translateY(-50%)";
						image.style.objectPosition = anchorLeft ? "left center" : "right center";
					}
				}
				if (fit === "width") image.style.height = "auto";
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
				if (frame.image?.parentElement === frame.element) frame.image.remove();
				frame.image = null;
				frame.entry = entry;
				frame.src = src;
				frame.element.dataset.tokiPage = entry?.key || "";
				frame.element.style.visibility = entry ? "visible" : "hidden";
				frame.message.style.display = "flex";
				frame.retry.hidden = true;
				if (!entry) return;
				frame.text.textContent = src ? `${entry.key}쪽 불러오는 중…` : `${entry.key}쪽: ${entry.siteError ? "원본 이미지 로딩 실패" : "이미지 준비 중"}`;
				if (!src) return;
				const old = imageCache.get(imageKey(entry));
				const record = cachedImage(entry, false, force || old?.status === "error");
				const image = record.image;
				frame.image = image;
				styleImage(image, frame);
				image.draggable = false;
				const update = () => {
					if (closed || frame.image !== image) return;
					styleImage(image, frame);
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
				if (!starts.includes(start)) start = [...starts].reverse().find((index) => index <= start) ?? 0;
				const pages = pagesAt(entries, starts, start);
				const fullWidth = pages.length === 1 && isSingle(pages[0]);
				const displayRtl = cover && start === 0 && pages.length === 1 && !fullWidth ? !rtl : rtl;
				const nextViewKey = JSON.stringify([
					pages.map((entry) => [entry.key, entry.page?.src]),
					fullWidth,
					displayRtl,
					fit
				]);
				if (viewKey !== nextViewKey) {
					cancelPendingActions();
					dismissPageMenu();
					viewKey = nextViewKey;
					zoom = 1;
					panX = panY = 0;
					swipe = pinch = mousePan = lastTap = null;
				}
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
				const fitIndex = FIT_MODES.findIndex((mode) => mode.value === fit);
				fitButton.textContent = FIT_MODES[fitIndex].label;
				fitButton.setAttribute("aria-label", FIT_MODES[fitIndex].label);
				fitButton.title = `${FIT_MODES[fitIndex].label} · 누르면 ${FIT_MODES[(fitIndex + 1) % FIT_MODES.length].label}`;
				fitButton.dataset.tokiFit = fit;
				pager.style.flexDirection = rtl ? "row-reverse" : "row";
				spread.style.flexDirection = displayRtl ? "row-reverse" : "row";
				frames.forEach((frame, index) => {
					frame.element.style.flexBasis = fullWidth ? "100%" : "50%";
					frame.element.style.width = fullWidth ? "100%" : "50%";
					frame.element.style.display = fullWidth && index === 1 ? "none" : "block";
					loadFrame(frame, pages[index]);
					if (frame.image) styleImage(frame.image, frame);
					frame.element.tabIndex = frame.entry?.page ? 0 : -1;
					frame.element.setAttribute("aria-label", `${frame.entry?.key || ""}쪽 · 길게 누르면 보기 설정`);
					frame.element.setAttribute("aria-haspopup", "dialog");
				});
				applyZoom();
				preloadNext(entries, starts);
			}
			function move(delta) {
				const starts = getStarts();
				const index = starts.indexOf(start);
				start = starts[Math.max(0, Math.min(starts.length - 1, index + delta))] ?? 0;
				draw();
			}
			function navigateGesture(delta) {
				const starts = getStarts();
				const position = starts.indexOf(start);
				if (position + delta < 0 || position + delta >= starts.length) setControlsVisible(true);
				else move(delta);
			}
			function changeEpisode(direction) {
				const control = findEpisodeControl(direction);
				if (!control) {
					draw();
					return;
				}
				const href = control.getAttribute("href");
				const destination = href ? routeKey(new URL(href, document.baseURI).href) : null;
				onEpisodeNavigation();
				try {
					sessionStorage.setItem(RESUME_KEY, JSON.stringify({
						from: routeKey(),
						destination,
						time: Date.now()
					}));
				} catch (_) {}
				close();
				control.click();
			}
			function close() {
				if (closed) return;
				closed = true;
				clearTimeout(controlsTimer);
				cancelPendingActions();
				dismissPageMenu(false);
				for (const frame of frames) frame.unsubscribe?.();
				for (const record of imageCache.values()) releaseImage(record);
				imageCache.clear();
				pageTypes.clear();
				singleOverrides.clear();
				if (ownsFullscreen && document.fullscreenElement === document.documentElement) Promise.resolve(document.exitFullscreen()).catch(console.error);
				try {
					if (dialog.open && typeof dialog.close === "function") dialog.close();
				} finally {
					dialog.remove();
					if (overflow) htmlStyle.setProperty("overflow", overflow, overflowPriority);
					else htmlStyle.removeProperty("overflow");
					removeEventListener("keydown", keydown, true);
					removeEventListener("resize", resizeViewer);
					removeEventListener("blur", cancelPendingActions);
					document.removeEventListener("fullscreenchange", updateFullscreenButton);
					document.removeEventListener("load", sourceLoaded, true);
					if (focusBefore?.isConnected) focusBefore.focus?.({ preventScroll: true });
					onClose();
				}
			}
			function keydown(event) {
				if (pageMenu) {
					event.stopImmediatePropagation();
					if (event.key === "Escape") {
						event.preventDefault();
						dismissPageMenu();
					} else if (event.key === "Tab") {
						event.preventDefault();
						(document.activeElement === pageMenu.toggle ? pageMenu.cancel : pageMenu.toggle).focus();
					} else if (!["Enter", " "].includes(event.key)) event.preventDefault();
					return;
				}
				if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") {
					const frame = frameAt(event.target);
					if (frame) {
						event.preventDefault();
						event.stopImmediatePropagation();
						openPageMenu(frame);
					}
					return;
				}
				if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isTyping(event)) return;
				const key = event.key.toLowerCase();
				let action;
				if (key === "escape" || key === "i") action = close;
				if ([
					"j",
					"pagedown",
					"arrowdown"
				].includes(key)) action = () => move(1);
				if ([
					"k",
					"pageup",
					"arrowup"
				].includes(key)) action = () => move(-1);
				if (key === "arrowleft") action = () => move(rtl ? 1 : -1);
				if (key === "arrowright") action = () => move(rtl ? -1 : 1);
				if (key === "l") action = () => changeEpisode("next");
				if (key === "h") action = () => changeEpisode("previous");
				if (zoom > 1 && key.startsWith("arrow")) action = () => {
					if (key === "arrowleft") panX += 80;
					if (key === "arrowright") panX -= 80;
					if (key === "arrowup") panY += 80;
					if (key === "arrowdown") panY -= 80;
					applyZoom();
				};
				if (!action) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				action();
			}
			let swipe = null;
			let pinch = null;
			let mousePan = null;
			let lastTap = null;
			let lastTouchAction = -Infinity;
			let lastTouchStart = -Infinity;
			function touchGeometry(touches) {
				const [a, b] = touches;
				const bounds = viewport.getBoundingClientRect();
				return {
					distance: Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)),
					x: (a.clientX + b.clientX) / 2 - bounds.left - bounds.width / 2,
					y: (a.clientY + b.clientY) / 2 - bounds.top - bounds.height / 2
				};
			}
			viewport.addEventListener("touchstart", (event) => {
				lastTouchStart = Date.now();
				cancelPress();
				if (event.target.closest("button")) return;
				if (event.touches.length >= 2) {
					cancelTap();
					if (event.cancelable) event.preventDefault();
					pinch = {
						...touchGeometry(event.touches),
						zoom,
						panX,
						panY
					};
					swipe = null;
					lastTap = null;
					lastTouchAction = Date.now();
					return;
				}
				const point = event.touches.length === 1 ? event.touches[0] : null;
				const doubleTap = point && lastTap && Date.now() - lastTap.time < 320 && Math.hypot(point.clientX - lastTap.x, point.clientY - lastTap.y) < 30;
				if (doubleTap) clearTimeout(tapTimer);
				else cancelTap();
				swipe = point ? {
					id: point.identifier,
					x: point.clientX,
					y: point.clientY,
					time: Date.now(),
					moved: false,
					panX,
					panY,
					panning: zoom > 1,
					doubleTap: !!doubleTap
				} : null;
				if (point && !longPressConsumed) armPress(event.target, point.clientX, point.clientY);
			}, { passive: false });
			viewport.addEventListener("touchmove", (event) => {
				if (pinch && event.touches.length >= 2) {
					if (event.cancelable) event.preventDefault();
					const current = touchGeometry(event.touches);
					zoom = Math.max(1, Math.min(4, pinch.zoom * current.distance / pinch.distance));
					panX = current.x - (pinch.x - pinch.panX) * zoom / pinch.zoom;
					panY = current.y - (pinch.y - pinch.panY) * zoom / pinch.zoom;
					applyZoom();
					return;
				}
				const point = [...event.touches].find((point) => point.identifier === swipe?.id);
				if (point) movePress(point.clientX, point.clientY);
				if (point && Math.hypot(point.clientX - swipe.x, point.clientY - swipe.y) > 10) {
					swipe.moved = true;
					cancelTap();
				}
				if (point && swipe.panning) {
					if (event.cancelable) event.preventDefault();
					panX = swipe.panX + point.clientX - swipe.x;
					panY = swipe.panY + point.clientY - swipe.y;
					applyZoom();
				}
			}, { passive: false });
			viewport.addEventListener("touchcancel", () => {
				cancelPendingActions();
				longPressConsumed = false;
				swipe = pinch = null;
				lastTouchAction = Date.now();
			}, { passive: true });
			viewport.addEventListener("touchend", (event) => {
				cancelPress();
				if (longPressConsumed) {
					if (event.cancelable) event.preventDefault();
					lastTouchAction = Date.now();
					if (!event.touches.length) longPressConsumed = false;
					return;
				}
				if (pinch) {
					if (event.cancelable) event.preventDefault();
					lastTouchAction = Date.now();
					if (!event.touches.length) pinch = null;
					return;
				}
				const initial = swipe;
				swipe = null;
				const point = [...event.changedTouches].find((point) => point.identifier === initial?.id);
				if (!initial || !point || event.touches.length || (window.visualViewport?.scale ?? 1) > 1.05) return;
				const dx = point.clientX - initial.x;
				const dy = point.clientY - initial.y;
				if (!initial.moved && Math.hypot(dx, dy) < 10 && Date.now() - initial.time < 800) {
					if (event.cancelable) event.preventDefault();
					event.stopPropagation();
					lastTouchAction = Date.now();
					if (initial.doubleTap) {
						cancelTap();
						resetZoom();
					} else {
						cancelTap();
						lastTap = {
							time: Date.now(),
							x: point.clientX,
							y: point.clientY
						};
						tapTimer = setTimeout(() => {
							const tap = lastTap;
							lastTap = null;
							if (tap && !closed && !pageMenu) handleTap(tap.x);
						}, 320);
					}
					return;
				}
				cancelTap();
				if (initial.panning) {
					if (event.cancelable) event.preventDefault();
					lastTouchAction = Date.now();
					return;
				}
				if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
				if (event.cancelable) event.preventDefault();
				event.stopPropagation();
				lastTouchAction = Date.now();
				navigateGesture(dx > 0 === rtl ? 1 : -1);
			}, { passive: false });
			viewport.addEventListener("pointerdown", (event) => {
				if (event.pointerType === "touch" || event.button !== 0 || event.target.closest("button")) return;
				armPress(event.target, event.clientX, event.clientY);
				if (zoom > 1) mousePan = {
					id: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					panX,
					panY,
					moved: false
				};
				viewport.setPointerCapture?.(event.pointerId);
			});
			viewport.addEventListener("pointermove", (event) => {
				if (event.pointerType !== "touch") movePress(event.clientX, event.clientY);
				if (!mousePan || event.pointerId !== mousePan.id) return;
				const dx = event.clientX - mousePan.x;
				const dy = event.clientY - mousePan.y;
				mousePan.moved ||= Math.hypot(dx, dy) > 5;
				panX = mousePan.panX + dx;
				panY = mousePan.panY + dy;
				applyZoom();
				spread.style.cursor = "grabbing";
			});
			const endMousePan = () => {
				cancelPress();
				if (mousePan?.moved) lastTouchAction = Date.now();
				mousePan = null;
				spread.style.cursor = zoom > 1 ? "grab" : "";
			};
			viewport.addEventListener("pointerup", endMousePan);
			viewport.addEventListener("pointercancel", endMousePan);
			viewport.addEventListener("lostpointercapture", endMousePan);
			viewport.addEventListener("contextmenu", (event) => {
				if (event.target.closest("button")) return;
				event.preventDefault();
				if (Date.now() - lastTouchStart < 1500 || longPressConsumed) return;
				openPageMenu(frameAt(event.target));
			});
			viewport.addEventListener("click", (event) => {
				if (longPressConsumed) {
					longPressConsumed = false;
					lastTouchAction = Date.now();
					return;
				}
				if (event.target.closest("button") || Date.now() - lastTouchAction < 800) return;
				setControlsVisible(!controlsVisible);
			});
			viewport.addEventListener("dblclick", (event) => {
				if (event.target.closest("button")) return;
				event.preventDefault();
				resetZoom();
			});
			const consumePressRelease = (event) => {
				if (!longPressConsumed || event.type === "pointerup" && event.pointerType === "touch") return;
				if (event.cancelable) event.preventDefault();
				event.stopImmediatePropagation();
				lastTouchAction = Date.now();
				if (!event.touches?.length) longPressConsumed = false;
			};
			dialog.addEventListener("touchend", consumePressRelease, {
				capture: true,
				passive: false
			});
			dialog.addEventListener("pointerup", consumePressRelease, true);
			dialog.addEventListener("cancel", (event) => {
				event.preventDefault();
				if (pageMenu) dismissPageMenu();
				else close();
			});
			document.body.append(dialog);
			try {
				dialog.showModal();
			} catch (_) {
				dialog.setAttribute("open", "");
				dialog.setAttribute("role", "dialog");
				dialog.setAttribute("aria-modal", "true");
			}
			htmlStyle.setProperty("overflow", "hidden");
			addEventListener("keydown", keydown, true);
			addEventListener("resize", resizeViewer);
			addEventListener("blur", cancelPendingActions);
			document.addEventListener("fullscreenchange", updateFullscreenButton);
			document.addEventListener("load", sourceLoaded, true);
			updateFullscreenButton();
			closeButton.focus({ preventScroll: true });
			draw();
			setControlsVisible(true);
			if (autoFullscreen && !document.fullscreenElement) toggleFullscreen();
			return {
				close,
				update(value) {
					snapshot = value;
					draw();
				}
			};
		}
		function isTyping(event) {
			const target = event.target;
			return target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "");
		}
		function start() {
			if (getOrigin() === "unknown" && !findImageArea() && !/뉴토끼|마나토끼|북토끼/.test(document.title)) return () => {};
			let guard = {
				route: routeKey(),
				blockedSources: new Map()
			};
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
				viewer = createSpreadViewer(snapshot, () => {
					viewer = null;
				}, true, () => checkpointEpisode(true));
			}
			const open = makeButton("두 쪽 보기", openViewer, report);
			panel.append(status, open, error);
			const shortcuts = new Map();
			function checkpointEpisode(force = false) {
				if (routeKey() !== guard.route || departingEntries && !force) return;
				const current = collectSnapshot(guard);
				departingEntries = current.current ? current.entries : ownedEntries;
			}
			function refresh() {
				if (stopped) return;
				if (routeKey() !== guard.route) {
					viewer?.close();
					guard = {
						route: routeKey(),
						blockedSources: new Map((departingEntries || ownedEntries).filter((entry) => entry.image && entry.rawSrc).map((entry) => [entry.image, entry.rawSrc]))
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
				for (const [nav, button] of shortcuts) if (!nav.isConnected) {
					button.remove();
					shortcuts.delete(nav);
				}
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
						if (resume && (!Number.isFinite(resume.time) || Date.now() - resume.time > 6e4)) {
							sessionStorage.removeItem(RESUME_KEY);
							resume = null;
						}
						if (resume && (resume.destination ? resume.destination === guard.route : resume.from !== guard.route)) sessionStorage.removeItem(RESUME_KEY);
						else resume = null;
					} catch (_) {
						resume = null;
					}
					if (resume) try {
						viewer = createSpreadViewer(snapshot, () => {
							viewer = null;
						}, false, () => checkpointEpisode(true));
					} catch (reason) {
						report(reason);
					}
				}
			}
			const schedule = () => {
				if (stopped || queued) return;
				queued = true;
				queueMicrotask(() => {
					queued = false;
					refresh();
				});
			};
			const disconnect = observeSource(schedule);
			const onNavigate = () => {
				if (routeKey() !== guard.route) refresh();
			};
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
				if (!target || target.tagName === "A" && (target.target && target.target !== "_self" || target.hasAttribute("download"))) return;
				if (findEpisodeControl("previous", target) || findEpisodeControl("next", target)) checkpointEpisode(true);
				else if (target.tagName === "A") {
					if (["previous", "next"].some((direction) => {
						const control = findEpisodeControl(direction);
						return control?.tagName === "A" && control.href === target.href;
					})) checkpointEpisode(true);
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
					else try {
						openViewer();
					} catch (reason) {
						report(reason);
					}
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
			const onHide = (event) => {
				if (!event.persisted) cleanup();
			};
			addEventListener("pagehide", onHide);
			refresh();
			return cleanup;
		}
		start();
	})();
})();
