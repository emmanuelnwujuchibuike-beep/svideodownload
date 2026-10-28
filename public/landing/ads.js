//#region lib/monetization/popunder-guard.ts
var e = {
	allowUntil: 0,
	blocked: 0,
	allowed: 0,
	installed: !1
};
function t(e, t) {
	return e <= t;
}
function n() {
	e.allowUntil = Date.now() + 1e3;
}
function r() {
	if (typeof window > "u" || e.installed) return;
	e.installed = !0;
	let n = window.open.bind(window);
	window.open = function(r, i, a) {
		return t(Date.now(), e.allowUntil) ? (e.allowUntil = 0, e.allowed += 1, n(r, i, a)) : (e.blocked += 1, null);
	};
}
//#endregion
//#region lib/net/cdn-bucket.ts
var i = 300 * 1e3;
function a(e = Date.now()) {
	return Math.floor(e / i);
}
//#endregion
//#region lib/monetization/ad-inventory-shape.ts
function o(e = Date.now()) {
	return a(e);
}
function s(e) {
	return Array.isArray(e) && e.every((e) => typeof e == "string") ? e : null;
}
function c(e) {
	if (!e || typeof e != "object") return null;
	let t = e, n = s(t.slots), r = s(t.vast);
	if (t.v !== 1 || !n || !r || typeof t.global != "boolean" || typeof t.monetag != "boolean") return null;
	let i = {
		v: 1,
		slots: n,
		vast: r,
		global: t.global,
		monetag: t.monetag
	};
	return typeof t.self == "boolean" && (i.self = t.self), i;
}
//#endregion
//#region features/monetization/ad-inventory-client.ts
var l = null;
function u() {
	return l != null || (l = fetch(`/api/ads/inventory?b=${o()}`).then((e) => e.ok ? e.json() : null).then(c).then((e) => e).catch(() => null)), l;
}
//#endregion
//#region lib/monetization/ads-config-client.ts
var d = null;
function ee() {
	return d != null || (d = fetch(`/api/ads/config?b=${a()}`).then((e) => e.ok ? e.json() : {}).catch(() => (d = null, {}))), d;
}
//#endregion
//#region lib/monetization/open-observer.ts
var f = {
	installed: !1,
	foreignOpened: 0,
	suppressUntil: 0,
	suppressed: 0,
	own: !1,
	gated: 0
}, p = null;
function m(e) {
	p = e, e && y();
}
function h(e, t) {
	if (!e) return !0;
	let n = 0;
	for (let r of e.matchAll(/blob:[^\s)'"]+|https?:\/\/[^\s)'"]+/g)) {
		if (r[0].startsWith("blob:")) return !0;
		try {
			if (new URL(r[0]).origin !== t) return !0;
			n += 1;
		} catch {
			return !0;
		}
	}
	return n === 0;
}
function g(e, t) {
	if (t || e.hasAttribute("download") || (e.target || "").toLowerCase() !== "_blank") return !1;
	try {
		let t = new URL(e.href, window.location.href);
		return (t.protocol === "https:" || t.protocol === "http:") && t.origin !== window.location.origin;
	} catch {
		return !1;
	}
}
function _(e) {
	var t, n;
	return f.own || !p || !h(e, (t = (n = window.location) == null ? void 0 : n.origin) == null ? "" : t) || p.allow() ? !1 : (f.gated += 1, !0);
}
var v = !1;
function y() {
	if (v || typeof HTMLAnchorElement > "u") return;
	v = !0;
	let e = HTMLAnchorElement.prototype.click;
	HTMLAnchorElement.prototype.click = function() {
		if (g(this, !1)) {
			var t, n;
			let e = (/* @__PURE__ */ Error()).stack;
			if (_(e)) return;
			!f.own && p && h(e, (t = (n = window.location) == null ? void 0 : n.origin) == null ? "" : t) && p.onOpened();
		}
		return e.call(this);
	}, window.addEventListener("click", (e) => {
		var t, n;
		let r = (t = e.target) == null || (n = t.closest) == null ? void 0 : n.call(t, "a");
		r && g(r, e.isTrusted) && _((/* @__PURE__ */ Error()).stack) && (e.preventDefault(), e.stopImmediatePropagation());
	}, !0);
}
function b() {
	if (typeof window > "u" || f.installed) return;
	f.installed = !0;
	let e = window.open.bind(window);
	window.open = function(t, n, r) {
		var i, a;
		if (!f.own && Date.now() < f.suppressUntil) return f.suppressed += 1, null;
		let o = (/* @__PURE__ */ Error()).stack, s = !f.own && !!p && h(o, (i = (a = window.location) == null ? void 0 : a.origin) == null ? "" : i);
		if (s && _(o)) return null;
		let c = e(t, n, r);
		return c && !f.own && (f.foreignOpened += 1), c && s && (p == null || p.onOpened()), c;
	};
}
function x() {
	return f.foreignOpened;
}
function S(e) {
	f.own = !0;
	try {
		n(), window.open(e, "_blank", "noopener");
	} finally {
		f.own = !1;
	}
}
function C(e) {
	f.suppressUntil = Date.now() + e;
}
//#endregion
//#region lib/monetization/direct-link.ts
function w(e) {
	if (typeof e != "string" || e.length > 2e3) return !1;
	try {
		let t = new URL(e.trim());
		return t.protocol === "https:" && !t.username && !t.password && t.hostname.includes(".");
	} catch {
		return !1;
	}
}
function T(e, t) {
	return t * 100 < e;
}
var E = [
	{
		id: "multitag",
		label: "Multitag",
		description: "One tag that serves all Monetag formats — the site-wide default."
	},
	{
		id: "in_page_push",
		label: "In-Page Push",
		description: "A native-style push widget rendered in the page. No browser permission needed."
	},
	{
		id: "push_notification",
		label: "Push Notifications",
		description: "Browser / OS push subscriptions. Monetag may also verify this via the service worker (already merged into /sw.js)."
	},
	{
		id: "vignette_banner",
		label: "Vignette Banner",
		description: "A full-screen interstitial shown between page views."
	},
	{
		id: "onclick_popunder",
		label: "OnClick (Popunder)",
		description: "Opens a monetised tab on the visitor's click. High-yield, but may affect an AdSense review."
	}
].map((e) => e.id);
new Set(E);
var D = [
	{
		id: "home",
		label: "Home page",
		hint: "The landing page (/).",
		group: "Public"
	},
	{
		id: "downloader",
		label: "Downloader pages",
		hint: "Every per-platform download & SEO page — the highest-traffic ad surface.",
		group: "Public"
	},
	{
		id: "content",
		label: "Blog, Academy & Help",
		hint: "/blog, /academy, /learn, /glossary, /topics, /help.",
		group: "Public"
	},
	{
		id: "info",
		label: "Info & legal",
		hint: "/about, /pricing, /features, /developers and the legal pages.",
		group: "Public"
	},
	{
		id: "app-download",
		label: "Download page",
		hint: "/downloads — the signed-in downloader.",
		group: "App (signed-in)"
	},
	{
		id: "app-home",
		label: "Home feed",
		hint: "/home — the signed-in feed.",
		group: "App (signed-in)"
	},
	{
		id: "app-reels",
		label: "Reels",
		hint: "/reels.",
		group: "App (signed-in)"
	},
	{
		id: "app-explore",
		label: "Explore",
		hint: "/explore.",
		group: "App (signed-in)"
	},
	{
		id: "app-messages",
		label: "Messages",
		hint: "/messages.",
		group: "App (signed-in)"
	},
	{
		id: "app-friends",
		label: "Friends",
		hint: "/friends.",
		group: "App (signed-in)"
	},
	{
		id: "app-saved",
		label: "Saved",
		hint: "/saved.",
		group: "App (signed-in)"
	},
	{
		id: "app-search",
		label: "Search",
		hint: "/search.",
		group: "App (signed-in)"
	},
	{
		id: "app-notifications",
		label: "Notifications",
		hint: "/notifications.",
		group: "App (signed-in)"
	},
	{
		id: "app-account",
		label: "Account & settings",
		hint: "/account, /create.",
		group: "App (signed-in)"
	}
].map((e) => e.id);
new Set(D);
var O = [
	{
		id: "download_complete",
		label: "After a download completes",
		hint: "When a file finishes downloading."
	},
	{
		id: "fetch_result",
		label: "When a link's result appears",
		hint: "The moment a pasted link resolves and the quality options are shown."
	},
	{
		id: "rewarded",
		label: "Rewarded (unlock HD / standard)",
		hint: "When the visitor unlocks a higher-quality download."
	},
	{
		id: "interstitial",
		label: "Full-screen interstitial",
		hint: "On a page change (navigation)."
	},
	{
		id: "idle",
		label: "When the visitor goes idle",
		hint: "After a few seconds with no interaction."
	},
	{
		id: "return",
		label: "On return",
		hint: "When the tab / app becomes visible again after being away."
	},
	{
		id: "backswipe",
		label: "On back-swipe",
		hint: "When the visitor taps or swipes back."
	}
].map((e) => e.id);
new Set(O);
//#endregion
//#region lib/monetization/spot-popunder.ts
function k(e) {
	return e.popunderOpened ? "popunder" : e.directOpened ? "direct" : "none";
}
//#endregion
//#region features/monetization/direct-link-runtime.ts
var A = "data-ad-spot", j = 1500, M = 1200, N = "idle", P = null, F = !1, I = null, L = !1, R = "frenz_spot_popunder_last";
function z() {
	try {
		var e, t;
		return Number((e = (t = window.localStorage) == null ? void 0 : t.getItem(R)) == null ? 0 : e) || 0;
	} catch {
		return 0;
	}
}
function B() {
	try {
		var e;
		(e = window.localStorage) == null || e.setItem(R, String(Date.now()));
	} catch {}
}
function V(e, t = Date.now()) {
	let n = Number(e.cooldownMinutes) || 0;
	return n > 0 && t - z() < n * 6e4;
}
function H(e = Date.now()) {
	return !!I && e - I.at <= j;
}
function U() {
	let e = Date.now();
	(!I || e - I.at > j) && (I = {
		at: e,
		opened: x(),
		lostFocus: !1
	}), n();
}
function W(e) {
	if (N !== "idle") return;
	N = "loading", b(), m({
		allow: () => (!e.spotsOnly || H()) && !V(e),
		onOpened: B
	}), window.addEventListener("blur", () => {
		I && (I.lostFocus = !0);
	});
	let t = document.createElement("script");
	t.async = !0, t.src = e.src, e.zone && (t.dataset.zone = e.zone), e.cfAsync && t.setAttribute("data-cfasync", "false"), t.setAttribute(e.provider === "adsterra" ? "data-adsterra" : "data-monetag", "spot_popunder"), t.onload = () => {
		N = "ready";
	}, t.onerror = () => {
		N = "failed";
	}, document.head.appendChild(t);
}
function G(e) {
	for (let t of document.querySelectorAll(`[${A}]`)) {
		if (!e.spots.includes(t.getAttribute("data-ad-spot"))) continue;
		let n = t.getBoundingClientRect(), r = window.innerWidth || 0, i = window.innerHeight || 0;
		if (n.width > 0 && n.height > 0 && n.bottom > 0 && n.right > 0 && (!i || n.top < i) && (!r || n.left < r)) return !0;
	}
	return !1;
}
var K = !1;
function q(e) {
	if (N !== "idle" || K) return;
	if (G(e)) {
		W(e);
		return;
	}
	if (typeof MutationObserver > "u") return;
	K = !0;
	let t = null, n = () => {
		t || (t = setTimeout(() => {
			if (t = null, N !== "idle") return i();
			G(e) && (i(), W(e));
		}, 400));
	}, r = new MutationObserver(n), i = () => {
		r.disconnect(), window.removeEventListener("scroll", n, !0), K = !1;
	};
	r.observe(document.body, {
		childList: !0,
		subtree: !0
	}), window.addEventListener("scroll", n, {
		capture: !0,
		passive: !0
	});
}
function J(e) {
	var t, n;
	if (!P) return;
	let r = e.target, i = (t = r == null || (n = r.closest) == null || (n = n.call(r, "[data-ad-spot]")) == null ? void 0 : n.getAttribute("data-ad-spot")) == null ? null : t;
	if (!i) for (let t of document.querySelectorAll(`[${A}]`)) {
		let n = t.getBoundingClientRect();
		if (e.clientX >= n.left && e.clientX <= n.right && e.clientY >= n.top && e.clientY <= n.bottom) {
			i = t.getAttribute(A);
			break;
		}
	}
	!i || !P.spots.includes(i) || (W(P), N === "ready" && U());
}
var Y = /* @__PURE__ */ new Set();
function X(e) {
	try {
		if (!e || typeof document > "u" || !document.head) return;
		let t = new URL(e, window.location.href).origin;
		if (!t.startsWith("https://") || Y.has(t) || t === window.location.origin) return;
		Y.add(t);
		for (let e of ["dns-prefetch", "preconnect"]) {
			let n = document.createElement("link");
			n.rel = e, n.href = t, e === "preconnect" && (n.crossOrigin = "anonymous"), document.head.appendChild(n);
		}
	} catch {}
}
async function Z(e) {
	let t = await ee(), n = (t) => {
		var n;
		return t && (n = t.spots) != null && n.includes(e) && w(t.url) ? t : null;
	}, r = [n(t == null ? void 0 : t.monetagDirectLink), n(t == null ? void 0 : t.adsterraSmartlink)].filter((e) => !!e), i = t == null ? void 0 : t.monetagSpotPopunder, a = i && Array.isArray(i.spots) && i.spots.includes(e) && typeof i.src == "string" && /^https:\/\//.test(i.src) ? i : null;
	if (!r.length && !a) return null;
	for (let e of r) X(e.url);
	X(a == null ? void 0 : a.src), a && (P = a, F || (F = !0, window.addEventListener("pointerdown", J, !0)), window.setTimeout(() => q(a), M));
	let o = () => {
		for (let e of r) if (T(e.chancePercent, Math.random())) return S(e.url), C(j), !0;
		return !1;
	};
	return (e) => {
		if (!a || N !== "ready") {
			let t = o();
			return e == null || e(k({
				popunderOpened: !1,
				directOpened: t
			})), r.length > 0;
		}
		if (V(a)) {
			let t = o();
			return e == null || e(k({
				popunderOpened: !1,
				directOpened: t
			})), r.length > 0;
		}
		if (L) return !0;
		L = !0, U();
		let t = I, n = !1, i = () => {
			if (n) return;
			n = !0, window.removeEventListener("click", i), L = !1, I = null;
			let r = x() > t.opened || t.lostFocus, a = !r && o();
			e == null || e(k({
				popunderOpened: r,
				directOpened: a
			}));
		};
		return window.addEventListener("click", i), window.setTimeout(i, 0), !0;
	};
}
//#endregion
//#region features/monetization/inject.ts
function Q(e, t) {
	let n = document.createElement("div");
	n.innerHTML = t;
	for (let t of Array.from(n.childNodes)) if (t.nodeName === "SCRIPT") {
		var r;
		let n = t, i = document.createElement("script");
		for (let e of Array.from(n.attributes)) i.setAttribute(e.name, e.value);
		i.text = (r = n.textContent) == null ? "" : r, e.appendChild(i);
	} else e.appendChild(t);
}
//#endregion
//#region features/monetization/landing-ads.ts
var $ = {};
async function te(e) {
	await Promise.all(e.map(async (e) => {
		e in $ || ($[e] = null, $[e] = await Z(e).catch(() => null));
	}));
}
function ne(e) {
	let t = $[e];
	return t ? t() : !1;
}
async function re() {
	try {
		var e;
		let t = await u();
		if (t && !t.global) return;
		let n = await fetch("/api/ads?zone=global&all=1"), r = n.ok ? await n.json() : { ads: [] };
		for (let t of (e = r.ads) == null ? [] : e) t.scriptCode && Q(document.body, t.scriptCode);
	} catch {}
}
//#endregion
export { te as armSpots, re as globalScripts, r as installPopunderGuard, ne as openSpot };
