(() => {
  "use strict";

  const API_BASE = location.hostname.endsWith("github.io")
    ? "https://ta3reebat-memberships.zx87s.chatgpt.site"
    : location.origin;
  const TOKEN_KEY = "zx87s_session";
  const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
  const MAX_UPLOAD_IMAGE_BYTES = 700 * 1024;
  const MAX_IMAGE_DIMENSION = 1920;
  const MAX_TRANSLATION_FILE_BYTES = 512 * 1024 * 1024;
  const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const PUBLIC_CACHE_TTL = 24 * 60 * 60 * 1000;
  const PUBLIC_CACHE_KEYS = { catalog: "zx87s_catalog_v1", news: "zx87s_news_v1" };
  const DETAIL_CACHE_TTL = 45 * 1000;
  const detailCache = new Map();
  const detailRequests = new Map();
  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: null,
    downloads: [],
    catalog: [],
    news: [],
    filter: "all",
    adminTranslations: [],
    adminNews: [],
    users: [],
    adminReports: [],
    invoices: [],
    adminInvoices: [],
    adminInvoiceFilter: "pending",
    translationRequests: [],
    adminTranslationRequests: [],
    activeTranslation: null,
    comments: [],
    replyingTo: null,
    notifications: [],
    unreadNotifications: 0,
    detailRequest: 0,
    activeTranslationReference: null,
    editing: null,
    editingNews: null,
    afterAuth: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const ICON_MARKUP = {
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 21h14"/>',
    comments: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/>',
    crown: '<path d="m3 7 4 4 5-7 5 7 4-4-2 11H5Z"/><path d="M5 21h14"/>',
    reply: '<path d="m9 17-6-5 6-5"/><path d="M3 12h10a7 7 0 0 1 7 7"/>',
    flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/>',
    upload: '<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M5 20h14"/>',
    edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10Z"/><path d="m13.5 6.5 3.5 3.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    logout: '<path d="M10 17v3H4V4h6v3"/><path d="M14 8l4 4-4 4m4-4H8"/>',
    save: '<path d="M5 3h12l2 2v16H5Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
    news: '<path d="M4 5h16v14H4Z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    calendar: '<path d="M6 2v4m12-4v4M3 9h18"/><rect x="3" y="4" width="18" height="17" rx="2"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    shield: '<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    eyeOff: '<path d="m3 3 18 18M10.6 6.2A11 11 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.5 7.2C3.6 9.1 2 12 2 12s3.5 6 10 6c1.2 0 2.3-.2 3.3-.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 3 3m-6 0 3 3"/>',
    gamepad: '<path d="M7 8h10a4 4 0 0 1 3.8 5.2l-1.2 4a2 2 0 0 1-3.3.9L14 16h-4l-2.3 2.1a2 2 0 0 1-3.3-.9l-1.2-4A4 4 0 0 1 7 8Z"/><path d="M7 12v3m-1.5-1.5h3M16 12h.01M18 14h.01"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  };

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("ui-icon");
    svg.innerHTML = ICON_MARKUP[name] || ICON_MARKUP.download;
    return svg;
  }

  function setIconText(node, iconName, text) {
    node.classList.add("has-icon");
    node.replaceChildren(icon(iconName), document.createTextNode(text));
    return node;
  }

  function makeIconText(tag, className, text, iconName) {
    return setIconText(make(tag, className), iconName, text);
  }

  function enhancePasswordInputs() {
    $$('input[type="password"]').forEach((input) => {
      if (input.parentElement?.classList.contains("password-control")) return;
      const wrapper = make("span", "password-control");
      input.parentNode.insertBefore(wrapper, input);
      wrapper.append(input);
      const toggle = make("button", "password-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-label", "إظهار كلمة المرور");
      toggle.title = "إظهار كلمة المرور";
      toggle.append(icon("eye"));
      toggle.addEventListener("click", () => {
        const visible = input.type === "text";
        input.type = visible ? "password" : "text";
        toggle.setAttribute("aria-label", visible ? "إظهار كلمة المرور" : "إخفاء كلمة المرور");
        toggle.title = visible ? "إظهار كلمة المرور" : "إخفاء كلمة المرور";
        toggle.replaceChildren(icon(visible ? "eye" : "eyeOff"));
      });
      wrapper.append(toggle);
    });
  }

  async function copyRecoveryCode() {
    const code = $("#recovery-code-value").textContent.trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast("تم نسخ رمز الاسترداد.");
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents($("#recovery-code-value"));
      selection.removeAllRanges();
      selection.addRange(range);
      toast("حددنا الرمز. انسخه الآن واحفظه في مكان آمن.");
    }
  }

  function confirmRecoveryCodeSaved() {
    closeDialog("recovery-code-dialog");
    $("#recovery-code-value").textContent = "";
    if (state.afterAuth === "vip") openVipSupport().catch((error) => toast(error.message, "error"));
    else if (state.afterAuth === "translation-request") openTranslationRequest().catch((error) => toast(error.message, "error"));
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    if (typeof options.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    let response;
    const method = String(options.method || "GET").toUpperCase();
    const attempts = method === "GET" ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        response = await fetch(`${API_BASE}${path}`, { ...options, headers });
        break;
      } catch {
        if (attempt + 1 < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        const error = new Error("تعذر الوصول إلى خادم الموقع. أعد المحاولة بعد لحظة.");
        error.status = 0;
        throw error;
      }
    }
    let result = {};
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) {
      const fallbackMessages = {
        401: "انتهت جلسة الدخول. سجّل الدخول مجددًا.",
        403: "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
        413: "حجم الملف أكبر من الحد المسموح.",
        429: "تم تنفيذ محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.",
        500: "حدث خطأ في الخادم أثناء تنفيذ الطلب.",
        503: "الخدمة غير متاحة مؤقتًا.",
      };
      const error = new Error(result.error || fallbackMessages[response.status] || `تعذر إكمال الطلب (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function setSession(result) {
    detailCache.clear();
    detailRequests.clear();
    if (result.token) {
      state.token = result.token;
      localStorage.setItem(TOKEN_KEY, result.token);
    }
    state.user = result.user;
    updateHeader();
    loadNotifications().catch(() => {});
  }

  function clearSession() {
    detailCache.clear();
    detailRequests.clear();
    state.token = "";
    state.user = null;
    state.downloads = [];
    state.invoices = [];
    state.adminInvoices = [];
    state.translationRequests = [];
    state.adminTranslationRequests = [];
    state.afterAuth = null;
    state.notifications = [];
    state.unreadNotifications = 0;
    localStorage.removeItem(TOKEN_KEY);
    closeDialog("notifications-dialog");
    closeDialog("vip-dialog");
    updateHeader();
  }

  function updateHeader() {
    setIconText($("#account-button"), "user", state.user ? "حسابي" : "دخول");
    setIconText($("#admin-button"), "settings", "الإدارة");
    $("#admin-button").hidden = state.user?.tier !== "owner";
    $("#notification-button").hidden = !state.user;
    updateNotificationBadge();
    renderCatalog();
    if (state.activeTranslation) renderTranslationDetail();
  }

  function updateNotificationBadge() {
    const count = Math.max(0, Number(state.unreadNotifications) || 0);
    const button = $("#notification-button");
    const badge = $("#notification-badge");
    badge.hidden = !state.user || count === 0;
    badge.textContent = count > 99 ? "99+" : String(count);
    button.setAttribute("aria-label", count ? `الإشعارات، ${count} غير مقروء` : "الإشعارات");
  }

  function notificationText(notification) {
    if (notification.type === "news") return `خبر جديد: ${notification.translationTitle}`;
    if (notification.type === "reply") return `${notification.actorUsername} رد على تعليقك`;
    if (notification.type === "heart") return `${notification.actorUsername} وضع قلبًا على تعليقك`;
    return `${notification.actorUsername} أضاف تعليقًا جديدًا`;
  }

  function renderNotifications() {
    const list = $("#notifications-list");
    if (!state.notifications.length) {
      list.replaceChildren(make("p", "empty-row", "لا توجد إشعارات."));
      return;
    }
    list.replaceChildren(...state.notifications.map((notification) => {
      const item = make("button", `notification-item${notification.isRead ? "" : " is-unread"}`);
      item.type = "button";
      const symbol = notification.type === "news" ? "news" : notification.type === "heart" ? "heart" : notification.type === "reply" ? "reply" : "comments";
      const iconBox = make("span", `notification-symbol ${notification.type}`);
      iconBox.append(icon(symbol));
      const content = make("span", "notification-content");
      content.append(
        make("strong", "", notificationText(notification)),
        make("span", "", notification.type === "news" ? "أخبار التعريبات" : `في ${notification.translationTitle}`),
        make("time", "", formatDateTime(notification.createdAt)),
      );
      item.append(iconBox, content);
      item.addEventListener("click", () => {
        closeDialog("notifications-dialog");
        if (notification.type === "news") {
          const target = document.getElementById(`news-${notification.newsId}`);
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          target?.classList.add("is-highlighted");
          setTimeout(() => target?.classList.remove("is-highlighted"), 1800);
        } else {
          openTranslation(notification.translationId);
        }
      });
      return item;
    }));
  }

  async function loadNotifications() {
    if (!state.token || !state.user) return;
    const result = await api("/api/notifications");
    state.notifications = Array.isArray(result.notifications) ? result.notifications : [];
    state.unreadNotifications = Number(result.unreadCount) || 0;
    updateNotificationBadge();
    if ($("#notifications-dialog").open) renderNotifications();
  }

  async function openNotifications() {
    if (!state.token) {
      showDialog("auth-dialog");
      return;
    }
    $("#notifications-list").replaceChildren(make("p", "empty-row", "جارٍ تحميل الإشعارات…"));
    showDialog("notifications-dialog");
    try {
      await loadNotifications();
      renderNotifications();
      if (state.unreadNotifications > 0) {
        await api("/api/notifications", { method: "PATCH" });
        state.unreadNotifications = 0;
        state.notifications.forEach((notification) => { notification.isRead = true; });
        updateNotificationBadge();
        renderNotifications();
      }
    } catch (error) {
      $("#notifications-list").replaceChildren(make("p", "empty-row", error.message));
    }
  }

  function showDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog?.open) dialog.close();
  }

  let toastTimer;
  function toast(message, type = "ok") {
    const node = $("#toast");
    node.textContent = message;
    node.dataset.type = type;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 3500);
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u064b-\u065f\u0670]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .toLocaleLowerCase("ar")
      .trim();
  }

  function readPublicCache(key) {
    try {
      const cached = JSON.parse(localStorage.getItem(key) || "null");
      if (!cached || !Array.isArray(cached.items) || Date.now() - Number(cached.savedAt) > PUBLIC_CACHE_TTL) {
        localStorage.removeItem(key);
        return null;
      }
      return cached.items;
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  }

  function writePublicCache(key, items) {
    try {
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), items }));
    } catch {
      // Public cache is an optional speed optimization.
    }
  }

  function hydratePublicCache() {
    const catalog = readPublicCache(PUBLIC_CACHE_KEYS.catalog);
    const news = readPublicCache(PUBLIC_CACHE_KEYS.news);
    if (catalog) state.catalog = catalog;
    if (news) state.news = news;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ar-OM", { dateStyle: "medium" }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "—"
      : new Intl.DateTimeFormat("ar-OM", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function toDateTimeLocal(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function publishedAtIso(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) throw new Error("تاريخ النشر غير صالح.");
    return date.toISOString();
  }

  function tierLabel(tier) {
    if (tier === "owner") return "Owner";
    if (tier === "vip") return "VIP";
    return "عضو";
  }

  function canAccessVip() {
    return state.user?.tier === "vip" || state.user?.tier === "owner";
  }

  function translationUrl(itemOrSlug, canonical = true) {
    const slug = typeof itemOrSlug === "string" ? itemOrSlug : itemOrSlug?.slug;
    const url = canonical ? new URL("https://zx87s.github.io/") : new URL(location.href);
    url.searchParams.set("game", slug);
    url.hash = "";
    return url;
  }

  function setTranslationRoute(item) {
    if (!item?.slug) return;
    history.pushState({ translation: item.slug }, "", translationUrl(item, false));
  }

  function clearTranslationRoute() {
    const url = new URL(location.href);
    if (!url.searchParams.has("game")) return;
    url.searchParams.delete("game");
    history.replaceState({}, "", url);
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const input = make("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("تعذر نسخ الرابط.");
  }

  function syncTranslationFromLocation() {
    const slug = new URL(location.href).searchParams.get("game");
    if (!slug) {
      if ($("#translation-dialog").open) closeDialog("translation-dialog");
      return;
    }
    const item = state.catalog.find((entry) => entry.slug === slug);
    const activeReference = state.activeTranslationReference;
    if ($("#translation-dialog").open && (
      state.activeTranslation?.slug === slug
      || activeReference === slug
      || (item && activeReference === String(item.id))
    )) return;
    openTranslation(item?.id || slug, { syncUrl: false });
  }

  function translationAction(item) {
    if (item.access !== "vip") return { label: "تنزيل التعريب", icon: "download", locked: false };
    return canAccessVip()
      ? { label: "تنزيل التعريب", icon: "download", locked: false }
      : { label: "تنزيل التعريب", icon: "download", locked: true };
  }

  async function loadNews(fresh = false) {
    try {
      const result = await api(`/api/news${fresh ? `?v=${Date.now()}` : ""}`, { cache: fresh ? "no-store" : "default" });
      state.news = Array.isArray(result.news) ? result.news : [];
      writePublicCache(PUBLIC_CACHE_KEYS.news, state.news);
      renderNews();
    } catch (error) {
      if (!state.news.length) $("#news-grid").replaceChildren(make("p", "empty-row", error.message));
    }
  }

  function renderNews() {
    const grid = $("#news-grid");
    if (!state.news.length) {
      grid.replaceChildren(make("p", "empty-row", "لا توجد أخبار منشورة."));
      return;
    }
    grid.replaceChildren(...state.news.map((post, index) => {
      const card = make("article", `news-card${index === 0 ? " is-latest" : ""}`);
      card.id = `news-${post.id}`;
      if (post.coverUrl) {
        const image = make("img", "news-cover");
        image.src = post.coverUrl;
        image.alt = post.title;
        image.loading = "lazy";
        image.decoding = "async";
        image.fetchPriority = "low";
        image.addEventListener("error", () => image.remove(), { once: true });
        card.append(image);
      }
      const content = make("div", "news-content");
      content.append(
        makeIconText("time", "news-date", formatDate(post.publishedAt), "news"),
        make("h3", "", post.title),
        make("p", "", post.body),
      );
      card.append(content);
      return card;
    }));
  }

  async function loadCatalog(fresh = false) {
    try {
      const result = await api(`/api/translations${fresh ? `?v=${Date.now()}` : ""}`, { cache: fresh ? "no-store" : "default" });
      state.catalog = Array.isArray(result.translations) ? result.translations : [];
      writePublicCache(PUBLIC_CACHE_KEYS.catalog, state.catalog);
      renderCatalog();
    } catch (error) {
      if (!state.catalog.length) {
        $("#results-status").textContent = error.message;
        $("#empty-state").hidden = false;
      }
    }
  }

  function visibleCatalog() {
    const query = normalize($("#catalog-search").value);
    return state.catalog.filter((item) => {
      const matchesFilter = state.filter === "all" || item.access === state.filter;
      return matchesFilter && (!query || normalize(`${item.title} ${item.description}`).includes(query));
    });
  }

  function renderCatalog() {
    const items = visibleCatalog();
    const grid = $("#catalog-grid");
    grid.replaceChildren(...items.map(makeCatalogCard));
    $("#empty-state").hidden = items.length > 0;
    $("#results-status").textContent = `${items.length} تعريب`;
  }

  function makeCatalogCard(item) {
    const card = make("article", "catalog-card");
    card.dataset.access = item.access;
    if (item.access === "vip" && !canAccessVip()) card.classList.add("is-vip-dimmed");
    const cover = make("div", "cover");
    cover.append(make("span", "type-badge", item.access === "vip" ? "VIP" : "مجاني"));
    if (item.isFeatured) cover.append(makeIconText("span", "featured-badge", "مميز", "star"));
    if (item.coverUrl) {
      const image = make("img");
      image.src = item.coverUrl;
      image.alt = `غلاف ${item.title}`;
      image.loading = "lazy";
      image.decoding = "async";
      image.fetchPriority = "low";
      image.addEventListener("error", () => image.remove(), { once: true });
      cover.prepend(image);
    }
    const body = make("div", "card-body");
    const top = make("div", "card-title-row");
    const heading = make("h3");
    const titleLink = make("a", "card-title-link", item.title);
    titleLink.href = translationUrl(item).toString();
    titleLink.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTranslation(item.id);
    });
    titleLink.addEventListener("focus", () => prefetchTranslation(item.id), { once: true });
    heading.append(titleLink);
    top.append(heading);
    const stats = make("div", "card-stats");
    stats.append(
      makeIconText("span", "stat-line downloads", `${Number(item.downloadCount) || 0} تحميل`, "download"),
      makeIconText("span", "stat-line comments-count", `${Number(item.commentCount) || 0} تعليق`, "comments"),
      makeIconText("time", "stat-line published-date", formatDate(item.publishedAt), "calendar"),
    );
    top.append(stats);
    body.append(top);
    if (item.description) body.append(make("p", "card-description", item.description));
    const action = translationAction(item);
    const button = makeIconText("button", "card-action", action.label, action.icon);
    button.classList.toggle("is-locked", action.locked);
    button.setAttribute("aria-disabled", action.locked ? "true" : "false");
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      downloadTranslation(item, button);
    });
    body.append(button);
    card.append(cover, body);
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, a")) return;
      openTranslation(item.id);
    });
    card.addEventListener("pointerenter", () => prefetchTranslation(item.id), { once: true });
    return card;
  }

  function cachedTranslation(reference) {
    const entry = detailCache.get(String(reference));
    if (!entry || Date.now() - entry.savedAt > DETAIL_CACHE_TTL) {
      detailCache.delete(String(reference));
      return null;
    }
    return entry.data;
  }

  async function fetchTranslationDetail(reference) {
    const key = String(reference);
    const cached = cachedTranslation(key);
    if (cached) return cached;
    if (detailRequests.has(key)) return detailRequests.get(key);
    const request = api(`/api/translations/${encodeURIComponent(key)}`)
      .then((result) => {
        const entry = { savedAt: Date.now(), data: result };
        detailCache.set(key, entry);
        if (result.translation?.id) detailCache.set(String(result.translation.id), entry);
        if (result.translation?.slug) detailCache.set(result.translation.slug, entry);
        return result;
      })
      .finally(() => detailRequests.delete(key));
    detailRequests.set(key, request);
    return request;
  }

  function prefetchTranslation(reference) {
    if (navigator.connection?.saveData) return;
    fetchTranslationDetail(reference).catch(() => {});
  }

  async function openTranslation(reference, { syncUrl = true } = {}) {
    const catalogItem = state.catalog.find((item) => item.id === reference || item.slug === reference);
    if (syncUrl && catalogItem) setTranslationRoute(catalogItem);
    state.activeTranslationReference = String(reference);
    const requestId = ++state.detailRequest;
    state.replyingTo = null;
    const detail = $("#translation-detail");
    detail.replaceChildren(make("p", "detail-loading", "جارٍ تحميل التعريب…"));
    showDialog("translation-dialog");
    try {
      const result = await fetchTranslationDetail(reference);
      if (requestId !== state.detailRequest || !$("#translation-dialog").open) return;
      state.activeTranslation = result.translation;
      state.comments = Array.isArray(result.comments) ? result.comments : [];
      document.title = `${state.activeTranslation.title} | تعريبات Zx87s`;
      renderTranslationDetail();
    } catch (error) {
      if (requestId !== state.detailRequest || !$("#translation-dialog").open) return;
      detail.replaceChildren(make("p", "empty-row", error.message));
    }
  }

  function renderTranslationDetail() {
    const item = state.activeTranslation;
    if (!item) return;
    const root = $("#translation-detail");
    const fragment = document.createDocumentFragment();

    const hero = make("section", "detail-hero");
    const cover = make("div", "detail-cover");
    if (item.coverUrl) {
      const image = make("img");
      image.src = item.coverUrl;
      image.alt = `صورة ${item.title}`;
      image.decoding = "async";
      image.fetchPriority = "high";
      cover.append(image);
    }
    const info = make("div", "detail-info");
    const badge = make("span", `type-badge detail-badge ${item.access}`, item.access === "vip" ? "VIP" : "مجاني");
    const badges = make("div", "detail-badges");
    badges.append(badge);
    if (item.isFeatured) badges.append(makeIconText("span", "featured-badge detail-featured", "تعريب مميز", "star"));
    info.append(badges, make("h2", "", item.title));
    if (item.description) info.append(make("p", "detail-description", item.description));
    const stats = make("div", "detail-stats");
    stats.append(
      makeIconText("span", "stat-line detail-download-count", `${Number(item.downloadCount) || 0} تحميل`, "download"),
      makeIconText("span", "stat-line detail-comment-count", `${Number(item.commentCount) || state.comments.length || 0} تعليق`, "comments"),
      makeIconText("time", "stat-line detail-published-date", `نُشر في ${formatDate(item.publishedAt)}`, "calendar"),
    );
    info.append(stats);
    const action = translationAction(item);
    const download = makeIconText("button", "button primary detail-download", action.label, action.icon);
    download.classList.toggle("is-locked", action.locked);
    download.setAttribute("aria-disabled", action.locked ? "true" : "false");
    download.type = "button";
    download.addEventListener("click", () => downloadTranslation(item, download));
    const copyLink = makeIconText("button", "button ghost copy-translation-link", "نسخ رابط التعريب", "copy");
    copyLink.type = "button";
    copyLink.addEventListener("click", async () => {
      try {
        await copyText(translationUrl(item).toString());
        toast("تم نسخ رابط التعريب.");
      } catch (error) {
        toast(error.message, "error");
      }
    });
    const detailActions = make("div", "detail-actions");
    detailActions.append(download, copyLink);
    info.append(detailActions);
    hero.append(cover, info);
    fragment.append(hero);

    const gallery = make("section", "detail-section");
    gallery.append(make("h3", "", "صور داخل اللعبة"));
    const galleryGrid = make("div", "detail-gallery");
    const images = Array.isArray(item.galleryUrls) ? item.galleryUrls.slice(0, 4) : [];
    if (!images.length) {
      galleryGrid.append(make("p", "empty-row", "لا توجد صور."));
    } else {
      images.forEach((url, index) => {
        const itemNode = make("div", "gallery-item");
        itemNode.append(make("span", "gallery-label", `الصورة ${index + 1}`));
        const button = make("button", "gallery-image");
        button.type = "button";
        button.setAttribute("aria-label", `تكبير الصورة ${index + 1}`);
        const image = make("img");
        image.src = url;
        image.alt = `${item.title} - صورة ${index + 1}`;
        image.loading = "lazy";
        image.decoding = "async";
        image.fetchPriority = "low";
        button.append(image);
        button.addEventListener("click", () => openLightbox(url, image.alt));
        itemNode.append(button);
        galleryGrid.append(itemNode);
      });
    }
    gallery.append(galleryGrid);
    fragment.append(gallery, makeCommentsSection());
    root.replaceChildren(fragment);
  }

  function openLightbox(url, alt) {
    const image = $("#lightbox-image");
    image.src = url;
    image.alt = alt;
    showDialog("image-dialog");
  }

  function makeCommentsSection() {
    const section = make("section", "detail-section comments-section");
    const heading = make("div", "comments-heading");
    heading.append(makeIconText("h3", "", "التعليقات", "comments"), make("span", "", String(state.comments.length)));
    section.append(heading);

    if (state.user) {
      const form = make("form", "comment-form");
      const textarea = make("textarea");
      textarea.name = "body";
      textarea.rows = 3;
      textarea.maxLength = 1000;
      textarea.required = true;
      textarea.placeholder = state.replyingTo ? `اكتب ردك على ${state.replyingTo.username}` : "اكتب تعليقك";
      if (state.replyingTo) {
        const replyContext = make("div", "reply-context");
        replyContext.append(
          makeIconText("span", "", `الرد على ${state.replyingTo.username}`, "reply"),
        );
        const cancelReply = make("button", "text-action", "إلغاء");
        cancelReply.type = "button";
        cancelReply.addEventListener("click", () => {
          state.replyingTo = null;
          renderTranslationDetail();
        });
        replyContext.append(cancelReply);
        form.append(replyContext);
      }
      const submit = makeIconText("button", "button primary", state.replyingTo ? "إرسال الرد" : "إضافة تعليق", state.replyingTo ? "reply" : "comments");
      submit.type = "submit";
      form.append(textarea, submit);
      form.addEventListener("submit", submitComment);
      section.append(form);
    } else {
      const login = makeIconText("button", "button ghost comment-login", "سجّل الدخول للتعليق", "user");
      login.type = "button";
      login.addEventListener("click", () => {
        closeDialog("translation-dialog");
        showDialog("auth-dialog");
      });
      section.append(login);
    }

    const list = make("div", "comments-list");
    if (!state.comments.length) {
      list.append(make("p", "empty-row", "لا توجد تعليقات."));
    } else {
      const existingIds = new Set(state.comments.map((comment) => comment.id));
      const children = new Map();
      state.comments.forEach((comment) => {
        const parentId = comment.parentId && existingIds.has(comment.parentId) ? comment.parentId : null;
        if (!children.has(parentId)) children.set(parentId, []);
        children.get(parentId).push(comment);
      });
      (children.get(null) || []).forEach((comment) => list.append(makeCommentThread(comment, children, 0, new Set())));
    }
    section.append(list);
    return section;
  }

  function makeCommentThread(comment, children, depth, ancestors) {
    const thread = make("div", "comment-thread");
    const nextAncestors = new Set(ancestors);
    if (nextAncestors.has(comment.id)) return thread;
    nextAncestors.add(comment.id);
    const row = make("article", `comment-card tier-${comment.author.tier}`);
    const head = make("div", "comment-head");
    const author = make("div", "comment-author");
    author.append(
      make("strong", "comment-author-name", comment.author.username),
      make("span", `tier-pill ${comment.author.tier}`, tierLabel(comment.author.tier)),
    );
    head.append(author, make("time", "", formatDate(comment.createdAt)));
    row.append(head, make("p", "comment-body", comment.body));
    const actions = make("div", "comment-actions");
    const heart = makeIconText(
      "button",
      `text-action heart-action${comment.likedByMe ? " is-liked" : ""}`,
      String(Number(comment.heartCount) || 0),
      "heart",
    );
    heart.type = "button";
    heart.setAttribute("aria-label", comment.likedByMe ? "إزالة القلب من التعليق" : "وضع قلب على التعليق");
    heart.setAttribute("aria-pressed", comment.likedByMe ? "true" : "false");
    heart.disabled = Boolean(comment.heartBusy || (state.user && !comment.canHeart && !comment.likedByMe));
    heart.addEventListener("click", () => toggleHeart(comment));
    actions.append(heart);
    if (state.user) {
      const reply = makeIconText("button", "text-action reply-action", "رد", "reply");
      reply.type = "button";
      reply.addEventListener("click", () => {
        state.replyingTo = { id: comment.id, username: comment.author.username };
        renderTranslationDetail();
        setTimeout(() => $(".comment-form textarea")?.focus(), 0);
      });
      actions.append(reply);
    }
    if (comment.canReport || comment.reportedByMe) {
      const report = makeIconText("button", "text-action report-action", comment.reportedByMe ? "تم التبليغ" : "تبليغ", "flag");
      report.type = "button";
      report.disabled = comment.reportedByMe;
      report.addEventListener("click", () => reportComment(comment));
      actions.append(report);
    }
    if (comment.canDelete) {
      const remove = makeIconText("button", "text-action delete-action", "حذف", "trash");
      remove.type = "button";
      remove.addEventListener("click", () => deleteComment(comment));
      actions.append(remove);
    }
    if (actions.childElementCount) row.append(actions);
    thread.append(row);
    const replies = (children.get(comment.id) || []).filter((child) => !nextAncestors.has(child.id));
    if (replies.length && depth < 20) {
      const repliesList = make("div", "comment-replies");
      replies.forEach((reply) => repliesList.append(makeCommentThread(reply, children, depth + 1, nextAncestors)));
      thread.append(repliesList);
    }
    return thread;
  }

  async function toggleHeart(comment) {
    if (!state.token) {
      closeDialog("translation-dialog");
      showDialog("auth-dialog");
      return;
    }
    if ((!comment.canHeart && !comment.likedByMe) || comment.heartBusy) return;
    comment.heartBusy = true;
    renderTranslationDetail();
    try {
      const result = await api(`/api/comments/${comment.id}/heart`, {
        method: comment.likedByMe ? "DELETE" : "POST",
      });
      comment.likedByMe = Boolean(result.liked);
      comment.heartCount = Number(result.heartCount) || 0;
    } catch (error) {
      if (error.status === 401) {
        clearSession();
        closeDialog("translation-dialog");
        showDialog("auth-dialog");
      } else {
        toast(error.message, "error");
      }
    } finally {
      comment.heartBusy = false;
      if (state.activeTranslation) renderTranslationDetail();
    }
  }

  async function submitComment(event) {
    event.preventDefault();
    if (!state.activeTranslation) return;
    const form = event.currentTarget;
    const submit = $("button[type=submit]", form);
    const body = $("textarea", form).value.trim();
    if (!body) return;
    submit.disabled = true;
    try {
      const result = await api(`/api/translations/${state.activeTranslation.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body, parentId: state.replyingTo?.id || null }),
      });
      state.comments.push(result.comment);
      state.replyingTo = null;
      updateActiveCommentCount(state.comments.length);
      renderTranslationDetail();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  }

  async function deleteComment(comment) {
    if (!confirm("حذف هذا التعليق وردوده؟")) return;
    try {
      await api(`/api/comments/${comment.id}`, { method: "DELETE" });
      const removedIds = new Set([comment.id]);
      let changed = true;
      while (changed) {
        changed = false;
        state.comments.forEach((item) => {
          if (item.parentId && removedIds.has(item.parentId) && !removedIds.has(item.id)) {
            removedIds.add(item.id);
            changed = true;
          }
        });
      }
      state.comments = state.comments.filter((item) => !removedIds.has(item.id));
      if (state.replyingTo && removedIds.has(state.replyingTo.id)) state.replyingTo = null;
      updateActiveCommentCount(state.comments.length);
      renderTranslationDetail();
      if (state.user?.role === "admin") await loadAdminReports();
      toast("تم حذف التعليق.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function updateActiveCommentCount(count) {
    if (!state.activeTranslation) return;
    state.activeTranslation.commentCount = count;
    const catalogItem = state.catalog.find((item) => item.id === state.activeTranslation.id);
    if (catalogItem) catalogItem.commentCount = count;
    renderCatalog();
  }

  async function reportComment(comment) {
    if (!confirm("إرسال بلاغ عن هذا التعليق؟")) return;
    try {
      await api(`/api/comments/${comment.id}/report`, { method: "POST" });
      comment.reportedByMe = true;
      comment.canReport = false;
      renderTranslationDetail();
      toast("تم إرسال البلاغ.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function downloadTranslation(item, button) {
    if (!state.token) {
      showDialog("auth-dialog");
      return;
    }
    if (item.access === "vip" && !canAccessVip()) {
      openVipSupport().catch((supportError) => toast(supportError.message, "error"));
      return;
    }
    button.disabled = true;
    setIconText(button, "download", "جارٍ التحميل…");
    try {
      const result = await api(`/api/translations/${item.id}/download`, { method: "POST" });
      item.downloadCount = result.downloadCount;
      if (state.activeTranslation?.id === item.id) state.activeTranslation.downloadCount = result.downloadCount;
      renderCatalog();
      if (state.activeTranslation?.id === item.id) renderTranslationDetail();
      const link = make("a");
      link.href = result.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      if (error.status === 401) {
        clearSession();
        showDialog("auth-dialog");
      } else if (error.status === 403) {
        openVipSupport().catch((supportError) => toast(supportError.message, "error"));
      } else {
        toast(error.message, "error");
      }
    } finally {
      button.disabled = false;
      const action = translationAction(item);
      setIconText(button, action.icon, action.label);
      button.classList.toggle("is-locked", action.locked);
      button.setAttribute("aria-disabled", action.locked ? "true" : "false");
    }
  }

  async function restoreSession() {
    if (!state.token) return;
    try {
      const result = await api("/api/auth/me");
      state.user = result.user;
      state.downloads = result.downloads || [];
      updateHeader();
      await loadNotifications();
    } catch {
      clearSession();
    }
  }

  function setAuthTab(tab) {
    $$('[data-auth-tab]').forEach((button) => button.classList.toggle("is-active", button.dataset.authTab === tab));
    $("#login-form").hidden = tab !== "login";
    $("#register-form").hidden = tab !== "register";
    $("#recover-form").hidden = tab !== "recover";
    $("#auth-message").textContent = "";
  }

  function showRecoveryCode(code) {
    $("#recovery-code-value").textContent = code;
    showDialog("recovery-code-dialog");
  }

  async function submitAuth(event, kind) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("button[type=submit]", form);
    const data = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    $("#auth-message").textContent = "";
    try {
      const result = await api(`/api/auth/${kind}`, { method: "POST", body: JSON.stringify(data) });
      setSession(result);
      form.reset();
      closeDialog("auth-dialog");
      toast(kind === "login" ? "تم تسجيل الدخول." : "تم إنشاء الحساب.");
      if (kind === "register" && result.recoveryCode) {
        showRecoveryCode(result.recoveryCode);
      } else if (state.afterAuth === "vip") {
        openVipSupport().catch((error) => toast(error.message, "error"));
      } else if (state.afterAuth === "translation-request") {
        openTranslationRequest().catch((error) => toast(error.message, "error"));
      }
    } catch (error) {
      $("#auth-message").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  async function submitRecovery(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("button[type=submit]", form);
    submit.disabled = true;
    $("#auth-message").textContent = "جارٍ التحقق…";
    try {
      await api("/api/auth/recover", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      form.reset();
      setAuthTab("login");
      $("#auth-message").textContent = "تم تغيير كلمة المرور وإلغاء الجلسات القديمة. سجّل الدخول بكلمة المرور الجديدة.";
    } catch (error) {
      $("#auth-message").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  async function openAccount() {
    if (!state.token) {
      state.afterAuth = null;
      showDialog("auth-dialog");
      return;
    }
    try {
      const [result, invoiceResult] = await Promise.all([
        api("/api/auth/me"),
        api("/api/paypal-invoices"),
      ]);
      state.user = result.user;
      state.downloads = result.downloads || [];
      state.invoices = invoiceResult.invoices || [];
      renderAccount();
      showDialog("account-dialog");
    } catch (error) {
      if (error.status === 401) clearSession();
      toast(error.message, "error");
    }
  }

  function renderAccount() {
    const user = state.user;
    if (!user) return;
    const summary = $("#account-summary");
    summary.replaceChildren();
    const items = [
      ["رقم الحساب", `#${user.id}`],
      ["اسم المستخدم", user.username],
      ["البريد الإلكتروني", user.email],
      ["انتهاء VIP", user.membership === "vip" ? formatDate(user.vipUntil) : "—"],
    ];
    for (const [label, value] of items) {
      const item = make("div", "summary-item");
      item.append(make("span", "", label), make("strong", "", value));
      summary.append(item);
    }
    const tier = make("div", "summary-item tier-summary");
    tier.append(make("span", "", "الفئة"), make("strong", `tier-pill ${user.tier}`, tierLabel(user.tier)));
    summary.append(tier);
    const form = $("#account-form");
    form.elements.username.value = user.username;
    form.elements.email.value = user.email;
    form.elements.currentPassword.value = "";
    form.elements.newPassword.value = "";
    $("#recovery-status").textContent = user.recoveryConfigured
      ? "لديك رمز استرداد محفوظ. إنشاء رمز جديد سيُلغي الرمز السابق فورًا."
      : "لا يوجد رمز استرداد محفوظ لهذا الحساب. أنشئه الآن واحتفظ به في مكان آمن.";
    $("#recovery-code-form").reset();
    $("#recovery-message").textContent = "";
    renderHistory();
    renderInvoiceHistory("#account-invoice-history");
  }

  function invoiceStatusLabel(status) {
    if (status === "approved") return "تمت الموافقة";
    if (status === "rejected") return "مرفوضة";
    return "قيد المراجعة";
  }

  function renderInvoiceHistory(selector) {
    const list = $(selector);
    if (!list) return;
    if (!state.invoices.length) {
      list.replaceChildren(make("p", "empty-row compact", "لا توجد طلبات."));
      return;
    }
    list.replaceChildren(...state.invoices.map((invoice) => {
      const row = make("article", `invoice-history-row status-${invoice.status}`);
      const info = make("div", "invoice-history-info");
      const number = make("code", "invoice-number", invoice.invoiceNumber);
      info.append(number, make("time", "", formatDateTime(invoice.createdAt)));
      if (invoice.reviewNote) info.append(make("p", "invoice-note", invoice.reviewNote));
      if (invoice.status === "approved" && invoice.approvedVipUntil) {
        info.append(make("span", "invoice-vip-until", `VIP حتى ${formatDate(invoice.approvedVipUntil)}`));
      }
      row.append(info, make("span", `invoice-status ${invoice.status}`, invoiceStatusLabel(invoice.status)));
      return row;
    }));
  }

  async function loadPaypalInvoices() {
    if (!state.user) {
      state.invoices = [];
      return;
    }
    const result = await api("/api/paypal-invoices");
    state.invoices = result.invoices || [];
    renderInvoiceHistory("#vip-invoice-history");
    renderInvoiceHistory("#account-invoice-history");
  }

  async function openVipSupport() {
    if (!state.user) {
      state.afterAuth = "vip";
      setAuthTab("login");
      showDialog("auth-dialog");
      return;
    }
    state.afterAuth = null;
    const account = $("#vip-account");
    account.replaceChildren(
      make("span", "", "سيُربط الطلب بالحساب"),
      make("strong", "", `${state.user.username} · #${state.user.id}`),
    );
    $("#invoice-message").textContent = "";
    showDialog("vip-dialog");
    await loadPaypalInvoices();
  }

  function translationRequestStatusLabel(status) {
    if (status === "approved") return "تمت الموافقة";
    if (status === "rejected") return "مرفوض";
    return "قيد المراجعة";
  }

  function renderTranslationRequestHistory() {
    const list = $("#translation-request-history");
    if (!state.translationRequests.length) {
      list.replaceChildren(make("p", "empty-row compact", "لم ترسل طلبات بعد."));
      return;
    }
    list.replaceChildren(...state.translationRequests.map((request) => {
      const row = make("article", "request-history-row");
      const image = make("img");
      image.src = request.imageUrl;
      image.alt = request.gameName;
      image.loading = "lazy";
      const info = make("div", "request-history-info");
      info.append(make("strong", "", request.gameName), make("time", "", formatDateTime(request.createdAt)));
      row.append(image, info, make("span", `request-status ${request.status}`, translationRequestStatusLabel(request.status)));
      return row;
    }));
  }

  async function loadTranslationRequests() {
    const result = await api("/api/translation-requests");
    state.translationRequests = result.requests || [];
    renderTranslationRequestHistory();
  }

  async function openTranslationRequest() {
    if (!state.user) {
      state.afterAuth = "translation-request";
      setAuthTab("login");
      showDialog("auth-dialog");
      return;
    }
    state.afterAuth = null;
    $("#translation-request-message").textContent = "";
    showDialog("translation-request-dialog");
    await loadTranslationRequests();
  }

  async function submitTranslationRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("button[type=submit]", form);
    submit.disabled = true;
    $("#translation-request-message").textContent = "جارٍ تجهيز الصورة وإرسال الطلب…";
    try {
      const selected = form.elements.requestImage.files?.[0];
      if (!selected) throw new Error("اختر صورة اللعبة من جهازك.");
      const prepared = await prepareImage(selected);
      const metadata = new TextEncoder().encode(JSON.stringify({
        gameName: form.elements.gameName.value,
        reason: form.elements.reason.value,
      }));
      if (metadata.byteLength > 12 * 1024) throw new Error("بيانات الطلب طويلة جدًا.");
      const metadataLength = new Uint8Array(4);
      new DataView(metadataLength.buffer).setUint32(0, metadata.byteLength);
      const body = new Blob([metadataLength, metadata, prepared], { type: "application/octet-stream" });
      await api("/api/translation-requests", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body,
      });
      form.reset();
      updateFileLabel(form.elements.requestImage);
      $("#translation-request-message").textContent = "تم إرسال الطلب إلى Owner للمراجعة.";
      await loadTranslationRequests();
      if (state.user?.role === "admin") await loadAdminTranslationRequests();
    } catch (error) {
      $("#translation-request-message").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  async function submitPaypalInvoice(event) {
    event.preventDefault();
    if (!state.user) {
      closeDialog("vip-dialog");
      await openVipSupport();
      return;
    }
    const form = event.currentTarget;
    const submit = $("button[type=submit]", form);
    const invoiceNumber = String(new FormData(form).get("invoiceNumber") || "").trim();
    submit.disabled = true;
    $("#invoice-message").textContent = "جارٍ إرسال الفاتورة…";
    try {
      await api("/api/paypal-invoices", {
        method: "POST",
        body: JSON.stringify({ invoiceNumber }),
      });
      form.reset();
      $("#invoice-message").textContent = "تم إرسال الفاتورة إلى Owner للمراجعة.";
      await loadPaypalInvoices();
    } catch (error) {
      $("#invoice-message").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  function renderHistory() {
    const list = $("#download-history");
    if (!state.downloads.length) {
      list.replaceChildren(make("p", "empty-row", "لا توجد تنزيلات."));
      return;
    }
    list.replaceChildren(...state.downloads.map((download) => {
      const row = make("div", "history-row");
      const info = make("div");
      info.append(make("strong", "", download.title), make("span", "", formatDate(download.downloadedAt)));
      row.append(info, make("span", `mini-badge ${download.access}`, download.access === "vip" ? "VIP" : "مجاني"));
      return row;
    }));
  }

  async function updateAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (!data.newPassword) delete data.newPassword;
    try {
      const result = await api("/api/auth/me", { method: "PATCH", body: JSON.stringify(data) });
      setSession(result);
      renderAccount();
      $("#account-message").textContent = "تم الحفظ.";
    } catch (error) {
      $("#account-message").textContent = error.message;
    }
  }

  async function generateRecoveryCode(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("button[type=submit]", form);
    submit.disabled = true;
    $("#recovery-message").textContent = "";
    try {
      const result = await api("/api/auth/recovery-code", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      state.user = result.user;
      form.reset();
      renderAccount();
      showRecoveryCode(result.recoveryCode);
    } catch (error) {
      $("#recovery-message").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* session is cleared locally */ }
    clearSession();
    closeDialog("account-dialog");
    toast("تم تسجيل الخروج.");
  }

  async function openAdmin() {
    if (state.user?.tier !== "owner") return;
    showDialog("admin-dialog");
    await loadAdminData();
  }

  async function loadAdminData() {
    try {
      const [translationResult, newsResult, userResult, reportResult, invoiceResult, requestResult] = await Promise.all([
        api("/api/admin/translations"),
        api("/api/admin/news"),
        api("/api/admin/users"),
        api("/api/admin/comment-reports"),
        api("/api/admin/paypal-invoices"),
        api("/api/admin/translation-requests"),
      ]);
      state.adminTranslations = translationResult.translations || [];
      state.adminNews = newsResult.news || [];
      state.users = userResult.users || [];
      state.adminReports = reportResult.reports || [];
      state.adminInvoices = invoiceResult.invoices || [];
      state.adminTranslationRequests = requestResult.requests || [];
      renderAdminOverview();
      renderAdminTranslations();
      renderAdminNews();
      renderUsers();
      renderAdminReports();
      renderAdminInvoices();
      renderAdminTranslationRequests();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function setAdminTab(tab) {
    $$('[data-admin-tab]').forEach((button) => button.classList.toggle("is-active", button.dataset.adminTab === tab));
    $("#admin-translations-panel").hidden = tab !== "translations";
    $("#admin-news-panel").hidden = tab !== "news";
    $("#admin-invoices-panel").hidden = tab !== "invoices";
    $("#admin-users-panel").hidden = tab !== "users";
    $("#admin-requests-panel").hidden = tab !== "requests";
    $("#admin-reports-panel").hidden = tab !== "reports";
  }

  function renderAdminOverview() {
    const pendingInvoices = state.adminInvoices.filter((invoice) => invoice.status === "pending").length;
    const pendingRequests = state.adminTranslationRequests.filter((request) => request.status === "pending").length;
    const metrics = [
      ["التعريبات", state.adminTranslations.length, "download", "translations"],
      ["المستخدمون", state.users.length, "user", "users"],
      ["فواتير معلقة", pendingInvoices, "receipt", "invoices"],
      ["طلبات تعريب", pendingRequests, "gamepad", "requests"],
    ];
    $("#admin-overview").replaceChildren(...metrics.map(([label, value, iconName, tab]) => {
      const card = make("button", "admin-metric");
      card.type = "button";
      const symbol = make("span", "admin-metric-icon");
      symbol.append(icon(iconName));
      const content = make("span", "admin-metric-content");
      content.append(make("strong", "", String(value)), make("small", "", label));
      card.append(symbol, content);
      card.addEventListener("click", () => setAdminTab(tab));
      return card;
    }));
    const invoiceTab = $('[data-admin-tab="invoices"]');
    setIconText(invoiceTab, "receipt", pendingInvoices ? `فواتير PayPal (${pendingInvoices})` : "فواتير PayPal");
    const requestsTab = $('[data-admin-tab="requests"]');
    setIconText(requestsTab, "gamepad", pendingRequests ? `طلبات التعريب (${pendingRequests})` : "طلبات التعريب");
  }

  function imageExtension(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
  }

  function canvasBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("تعذر تجهيز الصورة.")),
        "image/webp",
        quality,
      );
    });
  }

  async function decodeImage(file) {
    if (typeof createImageBitmap === "function") return createImageBitmap(file);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function prepareImage(file) {
    if (!(file instanceof File) || !SUPPORTED_IMAGE_TYPES.has(file.type)) {
      throw new Error("صيغة الصورة غير مدعومة. استخدم PNG أو JPG أو WEBP أو GIF.");
    }
    if (file.size < 1) throw new Error("الصورة فارغة أو غير صالحة.");
    if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error("حجم الصورة الأصلية يتجاوز 20MB.");
    if (file.type === "image/gif") {
      if (file.size > MAX_UPLOAD_IMAGE_BYTES) throw new Error("صورة GIF كبيرة جدًا. استخدم GIF أصغر من 700KB.");
      return file;
    }
    if (file.size <= MAX_UPLOAD_IMAGE_BYTES) return file;

    let source;
    try {
      source = await decodeImage(file);
      const sourceWidth = source.width || source.naturalWidth;
      const sourceHeight = source.height || source.naturalHeight;
      if (!sourceWidth || !sourceHeight) throw new Error("أبعاد الصورة غير صالحة.");
      if (sourceWidth * sourceHeight > 50_000_000) throw new Error("أبعاد الصورة كبيرة جدًا.");

      let scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight));
      let quality = 0.86;
      let blob = null;

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: true });
        if (!context) throw new Error("تعذر تجهيز الصورة في هذا المتصفح.");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(source, 0, 0, width, height);
        blob = await canvasBlob(canvas, quality);
        canvas.width = 1;
        canvas.height = 1;
        if (blob.size <= MAX_UPLOAD_IMAGE_BYTES) break;
        if (quality > 0.58) quality -= 0.08;
        else {
          scale *= 0.82;
          quality = 0.78;
        }
      }

      if (!blob || blob.size > MAX_UPLOAD_IMAGE_BYTES) {
        throw new Error("تعذر تقليل حجم الصورة إلى الحد المناسب.");
      }
      return new File([blob], `${imageExtension(file.name)}.webp`, {
        type: "image/webp",
        lastModified: Date.now(),
      });
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error("تعذر قراءة الصورة أو ضغطها.");
    } finally {
      if (source && typeof source.close === "function") source.close();
    }
  }

  async function uploadImages(files, onProgress) {
    const selected = Array.from(files || []);
    if (!selected.length) return [];
    if (selected.length > 4) throw new Error("يمكن رفع 4 صور داخل اللعبة كحد أقصى.");

    const uploaded = [];
    try {
      for (let index = 0; index < selected.length; index += 1) {
        onProgress?.(index + 1, selected.length, "prepare");
        const prepared = await prepareImage(selected[index]);
        onProgress?.(index + 1, selected.length, "upload");
        const result = await api("/api/admin/uploads", {
          method: "POST",
          headers: { "Content-Type": prepared.type || "application/octet-stream" },
          body: prepared,
        });
        const saved = result.files?.[0];
        if (!saved?.key) throw new Error("لم يُرجع الخادم نتيجة صحيحة لرفع الصورة.");
        uploaded.push(saved);
      }
      return uploaded;
    } catch (error) {
      await cleanupImages(uploaded.map((file) => file.key));
      throw error;
    }
  }

  async function cleanupImages(keys) {
    if (!keys.length) return;
    try {
      await api("/api/admin/uploads", {
        method: "DELETE",
        body: JSON.stringify({ keys }),
      });
    } catch {
      // Cleanup is best effort; the original error remains the useful message.
    }
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1) return "0 MB";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
    return `${Math.ceil(bytes / 1024)} KB`;
  }

  async function uploadTranslationPart(session, partNumber, chunk) {
    const query = new URLSearchParams({
      key: session.key,
      uploadId: session.uploadId,
      partNumber: String(partNumber),
    });
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const headers = new Headers({ "Content-Type": "application/octet-stream" });
        if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
        const response = await fetch(`${API_BASE}/api/admin/files/part?${query}`, {
          method: "POST",
          headers,
          body: chunk,
        });
        let result = {};
        try { result = await response.json(); } catch { result = {}; }
        if (!response.ok) {
          const error = new Error(result.error || `تعذر رفع جزء الملف (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        if (!result.etag || result.partNumber !== partNumber) throw new Error("لم يُحفظ جزء الملف بصورة صحيحة.");
        return result;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 600));
      }
    }
    throw lastError || new Error("تعذر رفع جزء الملف.");
  }

  async function uploadTranslationFile(file, onProgress) {
    if (!(file instanceof File) || file.size < 1) throw new Error("اختر ملف تعريب صالحًا.");
    if (file.size > MAX_TRANSLATION_FILE_BYTES) throw new Error("حجم ملف التعريب يتجاوز 512MB.");
    const session = await api("/api/admin/files/start", {
      method: "POST",
      body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
    });
    let completed = false;
    try {
      const parts = [];
      const partSize = Number(session.partSize);
      if (!Number.isInteger(partSize) || partSize < 5 * 1024 * 1024) throw new Error("إعداد رفع الملف غير صالح.");
      const totalParts = Math.ceil(file.size / partSize);
      for (let index = 0; index < totalParts; index += 1) {
        const start = index * partSize;
        const end = Math.min(start + partSize, file.size);
        const part = await uploadTranslationPart(session, index + 1, file.slice(start, end));
        parts.push({ partNumber: part.partNumber, etag: part.etag });
        onProgress?.(end, file.size);
      }
      const result = await api("/api/admin/files/complete", {
        method: "POST",
        body: JSON.stringify({
          key: session.key,
          uploadId: session.uploadId,
          name: file.name,
          size: file.size,
          parts,
        }),
      });
      completed = true;
      return result;
    } finally {
      if (!completed) {
        try {
          await api("/api/admin/files/abort", {
            method: "POST",
            body: JSON.stringify({ key: session.key, uploadId: session.uploadId }),
          });
        } catch {
          // The original upload error is more useful than a cleanup failure.
        }
      }
    }
  }

  async function cleanupTranslationFile(key) {
    if (!key) return;
    try {
      await api("/api/admin/files/delete", {
        method: "POST",
        body: JSON.stringify({ key }),
      });
    } catch {
      // Cleanup is best effort; the original save error remains visible.
    }
  }

  async function saveTranslation(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("button[type=submit]", form);
    const values = new FormData(form);
    const newKeys = [];
    let uploadedDownloadKey = null;
    let recordSaved = false;
    submit.disabled = true;
    $("#translation-message").textContent = "جارٍ الحفظ…";
    try {
      let coverKey = state.editing?.coverKey || null;
      let galleryKeys = state.editing?.galleryKeys || [];
      let downloadKey = state.editing?.downloadKey || null;
      let downloadName = state.editing?.downloadName || null;
      let downloadSize = state.editing?.downloadSize || null;
      const coverFiles = form.elements.cover.files;
      const galleryFiles = form.elements.gallery.files;
      const progress = (index, total, phase) => {
        const action = phase === "prepare" ? "تجهيز" : "رفع";
        $("#translation-message").textContent = `${action} الصور (${index}/${total})…`;
      };
      if (coverFiles.length) {
        const uploadedCover = await uploadImages(coverFiles, progress);
        coverKey = uploadedCover[0]?.key || coverKey;
        newKeys.push(...uploadedCover.map((file) => file.key));
      }
      if (galleryFiles.length) {
        const uploadedGallery = await uploadImages(galleryFiles, progress);
        galleryKeys = uploadedGallery.map((file) => file.key);
        newKeys.push(...galleryKeys);
      }
      const access = values.get("access");
      const selectedFile = form.elements.downloadFile.files?.[0];
      const externalUrl = String(values.get("downloadUrl") || "").trim();
      if (selectedFile) {
        const uploaded = await uploadTranslationFile(selectedFile, (uploadedBytes, totalBytes) => {
          const percent = Math.min(100, Math.round((uploadedBytes / totalBytes) * 100));
          $("#translation-message").textContent = `رفع ملف التعريب: ${percent}% (${formatBytes(uploadedBytes)} من ${formatBytes(totalBytes)})`;
        });
        downloadKey = uploaded.key;
        downloadName = uploaded.name;
        downloadSize = uploaded.size;
        uploadedDownloadKey = uploaded.key;
      } else if (access === "free" && externalUrl) {
        downloadKey = null;
        downloadName = null;
        downloadSize = null;
      }
      if (access === "vip" && !downloadKey) throw new Error("اختر ملف تعريب VIP من الجهاز.");
      if (access === "free" && !downloadKey && !externalUrl) {
        throw new Error("أدخل رابط التنزيل أو اختر ملف التعريب من الجهاز.");
      }
      $("#translation-message").textContent = "جارٍ حفظ بيانات التعريب…";
      const payload = {
        title: values.get("title"),
        slug: values.get("slug"),
        description: values.get("description"),
        access: values.get("access"),
        downloadUrl: access === "free" ? externalUrl : "",
        downloadKey,
        downloadName,
        downloadSize,
        isPublished: values.get("isPublished") === "on",
        isFeatured: values.get("isFeatured") === "on",
        publishedAt: publishedAtIso(values.get("publishedAt")),
        coverKey,
        galleryKeys,
      };
      const id = values.get("id");
      await api(id ? `/api/admin/translations/${id}` : "/api/admin/translations", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      recordSaved = true;
      resetTranslationForm();
      $("#translation-message").textContent = "تم الحفظ.";
      await Promise.all([loadAdminData(), loadCatalog(true)]);
    } catch (error) {
      if (!recordSaved) {
        await Promise.all([cleanupImages(newKeys), cleanupTranslationFile(uploadedDownloadKey)]);
      }
      $("#translation-message").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  function renderAdminTranslations() {
    const list = $("#admin-translations");
    if (!state.adminTranslations.length) {
      list.replaceChildren(make("p", "empty-row", "لا توجد تعريبات."));
      return;
    }
    list.replaceChildren(...state.adminTranslations.map((item) => {
      const row = make("article", "admin-row");
      const info = make("div", "admin-row-info");
      info.append(make("strong", "", item.title));
      info.append(make("span", "", `#${item.id} · ${item.access === "vip" ? "VIP" : "مجاني"}`));
      info.append(makeIconText("span", "admin-published-date", `تاريخ النشر: ${formatDate(item.publishedAt)}`, "calendar"));
      if (item.isFeatured) info.append(makeIconText("span", "admin-featured", "تعريب مميز", "star"));
      const stats = make("div", "admin-stats");
      stats.append(
        makeIconText("span", "stat-line", `${Number(item.downloadCount) || 0} تحميل`, "download"),
        makeIconText("span", "stat-line", `${Number(item.commentCount) || 0} تعليق`, "comments"),
      );
      info.append(stats);
      if (item.downloadName) info.append(makeIconText("span", "admin-file-name", `${item.downloadName} · ${formatBytes(item.downloadSize)}`, "upload"));
      if (!item.isPublished) info.append(make("span", "unpublished", "غير منشور"));
      const actions = make("div", "row-actions");
      const edit = makeIconText("button", "button ghost small", "تعديل", "edit");
      const remove = makeIconText("button", "button danger small", "حذف", "trash");
      edit.type = remove.type = "button";
      edit.addEventListener("click", () => editTranslation(item));
      remove.addEventListener("click", () => deleteTranslation(item));
      actions.append(edit, remove);
      row.append(info, actions);
      return row;
    }));
  }

  function editTranslation(item) {
    state.editing = item;
    const form = $("#translation-form");
    form.elements.cover.value = "";
    form.elements.gallery.value = "";
    form.elements.downloadFile.value = "";
    updateFileLabel(form.elements.cover);
    updateFileLabel(form.elements.gallery);
    updateFileLabel(form.elements.downloadFile);
    form.elements.id.value = item.id;
    form.elements.title.value = item.title;
    form.elements.slug.value = item.slug;
    form.elements.description.value = item.description;
    form.elements.access.value = item.access;
    form.elements.downloadUrl.value = item.downloadUrl || "";
    form.elements.isPublished.checked = item.isPublished;
    form.elements.isFeatured.checked = item.isFeatured;
    form.elements.publishedAt.value = item.publishedAt ? toDateTimeLocal(item.publishedAt) : "";
    syncDownloadFields();
    $("#cancel-edit").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateFileLabel(input) {
    const label = $(`[data-file-label="${input.name}"]`);
    if (!label) return;
    if (!input.files?.length) {
      label.textContent = input.name === "cover" || input.name === "newsCover"
        ? "لم تُحدد صورة"
        : input.name === "gallery"
          ? "لم تُحدد صور"
          : "لم يُحدد ملف";
      return;
    }
    label.textContent = input.files.length === 1 ? input.files[0].name : `${input.files.length} صور محددة`;
  }

  function resetTranslationForm() {
    state.editing = null;
    const form = $("#translation-form");
    form.reset();
    form.elements.id.value = "";
    form.elements.isPublished.checked = true;
    form.elements.isFeatured.checked = false;
    form.elements.publishedAt.value = toDateTimeLocal(new Date());
    updateFileLabel(form.elements.cover);
    updateFileLabel(form.elements.gallery);
    updateFileLabel(form.elements.downloadFile);
    syncDownloadFields();
    $("#cancel-edit").hidden = true;
  }

  function syncDownloadFields() {
    const form = $("#translation-form");
    const isVip = form.elements.access.value === "vip";
    $("#download-url-field").hidden = isVip;
    $("#download-file-field").hidden = false;
    form.elements.downloadUrl.required = false;
    form.elements.downloadFile.required = isVip && !state.editing?.downloadKey;
    const note = $("#download-file-note");
    if (state.editing?.downloadKey && !form.elements.downloadFile.files?.length) {
      note.textContent = `الملف الحالي: ${state.editing.downloadName} (${formatBytes(state.editing.downloadSize)}). اختر ملفًا جديدًا لاستبداله.`;
    } else if (isVip) {
      note.textContent = "ملف VIP مطلوب، ويُرفع من الجهاز على أجزاء حتى 512MB.";
    } else {
      note.textContent = "اختر ملفًا من الجهاز أو استخدم رابط التنزيل المجاني.";
    }
  }

  async function deleteTranslation(item) {
    if (!confirm(`حذف تعريب «${item.title}»؟`)) return;
    try {
      await api(`/api/admin/translations/${item.id}`, { method: "DELETE" });
      if (state.editing?.id === item.id) resetTranslationForm();
      await Promise.all([loadAdminData(), loadCatalog(true)]);
      toast("تم حذف التعريب.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function saveNews(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("button[type=submit]", form);
    const values = new FormData(form);
    let uploadedKey = null;
    let recordSaved = false;
    submit.disabled = true;
    $("#news-message").textContent = "جارٍ حفظ الخبر…";
    try {
      let coverKey = state.editingNews?.coverKey || null;
      if (values.get("removeCover") === "on") coverKey = null;
      const selectedCover = form.elements.newsCover.files;
      if (selectedCover.length) {
        const uploaded = await uploadImages(selectedCover, (index, total, phase) => {
          $("#news-message").textContent = phase === "prepare" ? "جارٍ تجهيز الصورة…" : `جارٍ رفع الصورة (${index}/${total})…`;
        });
        uploadedKey = uploaded[0]?.key || null;
        if (!uploadedKey) throw new Error("لم تُرفع صورة الخبر بصورة صحيحة.");
        coverKey = uploadedKey;
      }
      const payload = {
        title: values.get("title"),
        body: values.get("body"),
        coverKey,
        isPublished: values.get("isPublished") === "on",
      };
      const id = values.get("id");
      const result = await api(id ? `/api/admin/news/${id}` : "/api/admin/news", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const savedNews = result.news;
      if (savedNews) {
        state.news = state.news.filter((post) => post.id !== savedNews.id);
        if (savedNews.isPublished) state.news.unshift(savedNews);
        writePublicCache(PUBLIC_CACHE_KEYS.news, state.news);
        renderNews();
      }
      recordSaved = true;
      resetNewsForm();
      $("#news-message").textContent = "تم حفظ الخبر.";
      await Promise.all([loadAdminData(), loadNews(true), loadNotifications()]);
    } catch (error) {
      if (!recordSaved && uploadedKey) await cleanupImages([uploadedKey]);
      $("#news-message").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  function renderAdminNews() {
    const list = $("#admin-news");
    if (!state.adminNews.length) {
      list.replaceChildren(make("p", "empty-row", "لا توجد أخبار."));
      return;
    }
    list.replaceChildren(...state.adminNews.map((post) => {
      const row = make("article", "admin-row news-admin-row");
      const info = make("div", "admin-row-info");
      info.append(
        make("strong", "", post.title),
        make("span", "", post.isPublished ? `منشور · ${formatDate(post.publishedAt)}` : "غير منشور"),
        make("p", "admin-news-excerpt", post.body),
      );
      const actions = make("div", "row-actions");
      const edit = makeIconText("button", "button ghost small", "تعديل", "edit");
      const remove = makeIconText("button", "button danger small", "حذف", "trash");
      edit.type = remove.type = "button";
      edit.addEventListener("click", () => editNews(post));
      remove.addEventListener("click", () => deleteNews(post));
      actions.append(edit, remove);
      row.append(info, actions);
      return row;
    }));
  }

  function editNews(post) {
    state.editingNews = post;
    const form = $("#news-form");
    form.elements.id.value = post.id;
    form.elements.title.value = post.title;
    form.elements.body.value = post.body;
    form.elements.isPublished.checked = post.isPublished;
    form.elements.removeCover.checked = false;
    form.elements.newsCover.value = "";
    updateFileLabel(form.elements.newsCover);
    $("#cancel-news-edit").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetNewsForm() {
    state.editingNews = null;
    const form = $("#news-form");
    form.reset();
    form.elements.id.value = "";
    form.elements.isPublished.checked = true;
    updateFileLabel(form.elements.newsCover);
    $("#cancel-news-edit").hidden = true;
  }

  async function deleteNews(post) {
    if (!confirm(`حذف خبر «${post.title}»؟`)) return;
    try {
      await api(`/api/admin/news/${post.id}`, { method: "DELETE" });
      state.news = state.news.filter((item) => item.id !== post.id);
      writePublicCache(PUBLIC_CACHE_KEYS.news, state.news);
      renderNews();
      if (state.editingNews?.id === post.id) resetNewsForm();
      await Promise.all([loadAdminData(), loadNews(true), loadNotifications()]);
      toast("تم حذف الخبر.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderAdminInvoices() {
    const list = $("#admin-invoices");
    const invoices = state.adminInvoices.filter((invoice) => (
      state.adminInvoiceFilter === "all" || invoice.status === state.adminInvoiceFilter
    ));
    if (!invoices.length) {
      list.replaceChildren(make("p", "empty-row", "لا توجد فواتير في هذه الفئة."));
      return;
    }
    list.replaceChildren(...invoices.map((invoice) => {
      const row = make("article", `paypal-invoice-row status-${invoice.status}`);
      const main = make("div", "paypal-invoice-main");
      const top = make("div", "paypal-invoice-top");
      const number = make("code", "invoice-number", invoice.invoiceNumber);
      top.append(number, make("span", `invoice-status ${invoice.status}`, invoiceStatusLabel(invoice.status)));
      const person = make("div", "invoice-person");
      person.append(
        makeIconText("strong", "", `${invoice.username} · #${invoice.userId}`, "user"),
        make("span", `tier-pill ${invoice.userTier}`, tierLabel(invoice.userTier)),
      );
      const details = make("div", "invoice-meta");
      details.append(
        make("span", "", invoice.email),
        makeIconText("time", "", `أُرسلت ${formatDateTime(invoice.createdAt)}`, "calendar"),
      );
      main.append(top, person, details);
      if (invoice.reviewNote) main.append(make("p", "invoice-review-note", `ملاحظة: ${invoice.reviewNote}`));
      if (invoice.status === "approved" && invoice.approvedVipUntil) {
        main.append(makeIconText("p", "invoice-approved-until", `تم تفعيل VIP حتى ${formatDate(invoice.approvedVipUntil)}`, "crown"));
      }

      const actions = make("div", "invoice-actions");
      if (invoice.status === "pending") {
        const approve = makeIconText("button", "button approve small", "موافقة وتفعيل 30 يومًا", "check");
        const reject = makeIconText("button", "button danger small", "رفض", "close");
        approve.type = reject.type = "button";
        approve.addEventListener("click", () => reviewPaypalInvoice(invoice, "approve"));
        reject.addEventListener("click", () => reviewPaypalInvoice(invoice, "reject"));
        actions.append(approve, reject);
      }
      const remove = makeIconText("button", "button danger small", "حذف الفاتورة", "trash");
      remove.type = "button";
      remove.addEventListener("click", () => deletePaypalInvoice(invoice));
      actions.append(remove);
      row.append(main, actions);
      return row;
    }));
  }

  async function reviewPaypalInvoice(invoice, action) {
    let note = "";
    if (action === "approve") {
      if (!confirm(`تأكيد فاتورة ${invoice.invoiceNumber} وتفعيل VIP للحساب #${invoice.userId} لمدة 30 يومًا؟`)) return;
    } else {
      const result = prompt(`سبب رفض فاتورة ${invoice.invoiceNumber} (اختياري):`, "");
      if (result === null) return;
      note = result.trim();
    }
    try {
      await api(`/api/admin/paypal-invoices/${invoice.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, note }),
      });
      await loadAdminData();
      toast(action === "approve" ? "تمت الموافقة وتفعيل VIP لمدة 30 يومًا." : "تم رفض الفاتورة.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function deletePaypalInvoice(invoice) {
    if (!confirm(`حذف فاتورة PayPal رقم ${invoice.invoiceNumber} من السجل؟\nلن تتغير عضوية VIP الحالية للحساب.`)) return;
    try {
      await api(`/api/admin/paypal-invoices/${invoice.id}`, { method: "DELETE" });
      state.adminInvoices = state.adminInvoices.filter((item) => item.id !== invoice.id);
      renderAdminInvoices();
      renderAdminOverview();
      toast("تم حذف الفاتورة دون تغيير عضوية المستخدم.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function loadAdminTranslationRequests() {
    if (state.user?.role !== "admin") return;
    const result = await api("/api/admin/translation-requests");
    state.adminTranslationRequests = result.requests || [];
    renderAdminTranslationRequests();
    renderAdminOverview();
  }

  function renderAdminTranslationRequests() {
    const list = $("#admin-requests");
    if (!state.adminTranslationRequests.length) {
      list.replaceChildren(make("p", "empty-row", "لا توجد طلبات تعريب."));
      return;
    }
    list.replaceChildren(...state.adminTranslationRequests.map((request) => {
      const row = make("article", "admin-row localization-request-row");
      const main = make("div", "request-admin-main");
      const image = make("img", "request-admin-image");
      image.src = request.imageUrl;
      image.alt = request.gameName;
      image.loading = "lazy";
      image.tabIndex = 0;
      image.addEventListener("click", () => openLightbox(request.imageUrl, request.gameName));
      image.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") openLightbox(request.imageUrl, request.gameName);
      });
      const info = make("div", "admin-row-info");
      info.append(
        make("strong", "", request.gameName),
        make("span", "", `${request.user.username} · #${request.user.id} · ${formatDateTime(request.createdAt)}`),
        make("span", `tier-pill ${request.user.tier}`, tierLabel(request.user.tier)),
        make("p", "request-admin-reason", request.reason),
        make("span", `request-status ${request.status}`, translationRequestStatusLabel(request.status)),
      );
      main.append(image, info);
      const actions = make("div", "row-actions request-admin-actions");
      if (request.status === "pending") {
        const approve = makeIconText("button", "button approve small", "موافقة", "check");
        const reject = makeIconText("button", "button danger small", "رفض", "close");
        approve.type = reject.type = "button";
        approve.addEventListener("click", () => reviewTranslationRequest(request, "approve"));
        reject.addEventListener("click", () => reviewTranslationRequest(request, "reject"));
        actions.append(approve, reject);
      }
      const remove = makeIconText("button", "button danger small", "حذف الطلب", "trash");
      remove.type = "button";
      remove.addEventListener("click", () => deleteTranslationRequest(request));
      actions.append(remove);
      row.append(main, actions);
      return row;
    }));
  }

  async function reviewTranslationRequest(request, action) {
    const verb = action === "approve" ? "الموافقة على" : "رفض";
    if (!confirm(`تأكيد ${verb} طلب تعريب ${request.gameName}؟`)) return;
    try {
      await api(`/api/admin/translation-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      await loadAdminTranslationRequests();
      toast(action === "approve" ? "تمت الموافقة على الطلب." : "تم رفض الطلب.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function deleteTranslationRequest(request) {
    if (!confirm(`حذف طلب تعريب «${request.gameName}» نهائيًا؟`)) return;
    try {
      await api(`/api/admin/translation-requests/${request.id}`, { method: "DELETE" });
      state.adminTranslationRequests = state.adminTranslationRequests.filter((item) => item.id !== request.id);
      renderAdminTranslationRequests();
      renderAdminOverview();
      toast("تم حذف طلب التعريب.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderUsers() {
    const list = $("#admin-users");
    if (!state.users.length) {
      list.replaceChildren(make("p", "empty-row", "لا يوجد مستخدمون."));
      return;
    }
    list.replaceChildren(...state.users.map((user) => {
      const row = make("article", "admin-row user-row");
      const info = make("div", "admin-row-info");
      info.append(make("strong", "", `${user.username} · #${user.id}`));
      info.append(make("span", "", user.email));
      const membershipText = user.tier === "owner"
        ? "Owner"
        : user.tier === "vip"
          ? `VIP حتى ${formatDate(user.vipUntil)}`
          : "عضو";
      info.append(make("span", `tier-pill ${user.tier}`, membershipText));
      const actions = make("div", "membership-actions");
      const days = make("input");
      days.type = "number";
      days.min = "1";
      days.max = "3650";
      days.value = "30";
      days.setAttribute("aria-label", "عدد الأيام");
      const grant = makeIconText("button", "button primary small", "منح VIP", "crown");
      const revoke = makeIconText("button", "button danger small", "إلغاء VIP", "trash");
      const resetPassword = makeIconText("button", "button ghost small", "إعادة تعيين كلمة المرور", "key");
      const deleteUser = makeIconText("button", "button danger small", "مسح الحساب", "trash");
      grant.type = revoke.type = resetPassword.type = deleteUser.type = "button";
      grant.addEventListener("click", () => updateMembership(user.id, "grant", Number(days.value)));
      revoke.addEventListener("click", () => updateMembership(user.id, "revoke"));
      resetPassword.addEventListener("click", () => resetUserPassword(user));
      deleteUser.disabled = user.tier === "vip" || user.tier === "owner";
      deleteUser.title = user.tier === "vip"
        ? "الحذف متوقف لحماية عضوية VIP من الضياع"
        : user.tier === "owner" ? "لا يمكن حذف حساب Owner" : "مسح الحساب نهائيًا";
      deleteUser.addEventListener("click", () => deleteUserAccount(user));
      actions.append(days, grant, revoke, resetPassword, deleteUser);
      row.append(info, actions);
      return row;
    }));
  }

  async function updateMembership(id, action, days = 30) {
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ action, days }) });
      await loadAdminData();
      toast(action === "grant" ? "تم منح VIP." : "تم إلغاء VIP.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function resetUserPassword(user) {
    const password = prompt(`اكتب كلمة مرور مؤقتة قوية للحساب ${user.username} · #${user.id}:`, "");
    if (password === null) return;
    if (password.length < 10 || password.length > 128 || !/\p{L}/u.test(password) || !/\p{N}/u.test(password) || !/[^\p{L}\p{N}\s]/u.test(password)) {
      toast("استخدم 10 أحرف على الأقل تتضمن حروفًا وأرقامًا ورمزًا خاصًا.", "error");
      return;
    }
    if (!confirm("سيتم تغيير كلمة المرور وإلغاء كل الجلسات القديمة، وستبقى عضوية VIP كما هي. هل تريد المتابعة؟")) return;
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reset_password", password }),
      });
      if (user.id === state.user?.id) {
        clearSession();
        closeDialog("admin-dialog");
        toast("تم تغيير كلمة المرور وإلغاء الجلسات. سجّل الدخول من جديد.");
        return;
      }
      await loadAdminData();
      toast("تم تغيير كلمة المرور وإلغاء جلسات الحساب دون تغيير VIP.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function deleteUserAccount(user) {
    if (user.tier === "vip" || user.tier === "owner") return;
    const confirmationUsername = prompt(`لحذف الحساب نهائيًا، اكتب اسم المستخدم كما هو:\n${user.username}`, "");
    if (confirmationUsername === null) return;
    if (!confirm(`سيُحذف الحساب #${user.id} وتعليقاته وسجلاته نهائيًا. هل أنت متأكد؟`)) return;
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmationUsername }),
      });
      await loadAdminData();
      toast("تم مسح الحساب.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function loadAdminReports() {
    if (state.user?.role !== "admin") return;
    try {
      const result = await api("/api/admin/comment-reports");
      state.adminReports = result.reports || [];
      renderAdminReports();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderAdminReports() {
    const list = $("#admin-reports");
    if (!state.adminReports.length) {
      list.replaceChildren(make("p", "empty-row", "لا توجد بلاغات."));
      return;
    }
    list.replaceChildren(...state.adminReports.map((report) => {
      const row = make("article", "admin-row report-row");
      const info = make("div", "admin-row-info");
      const title = make("strong", "", report.translationTitle);
      const author = make("span", "report-author");
      author.append(
        document.createTextNode(`${report.authorUsername} · `),
        make("b", `tier-text ${report.authorTier}`, tierLabel(report.authorTier)),
        document.createTextNode(` · ${report.reportCount} بلاغ`),
      );
      info.append(title, author, make("p", "reported-comment", report.body));
      const actions = make("div", "row-actions");
      const dismiss = makeIconText("button", "button danger small", "حذف البلاغ", "trash");
      const remove = makeIconText("button", "button danger small", "حذف التعليق", "trash");
      dismiss.type = remove.type = "button";
      dismiss.addEventListener("click", () => dismissReports(report.commentId));
      remove.addEventListener("click", () => deleteReportedComment(report.commentId));
      actions.append(dismiss, remove);
      row.append(info, actions);
      return row;
    }));
  }

  async function dismissReports(commentId) {
    if (!confirm("حذف جميع البلاغات المرتبطة بهذا التعليق؟ لن يُحذف التعليق نفسه.")) return;
    try {
      await api(`/api/comments/${commentId}/reports`, { method: "DELETE" });
      state.adminReports = state.adminReports.filter((report) => report.commentId !== commentId);
      renderAdminReports();
      renderAdminOverview();
      toast("تم حذف البلاغ.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function deleteReportedComment(commentId) {
    if (!confirm("حذف التعليق المُبلغ عنه؟")) return;
    try {
      await api(`/api/comments/${commentId}`, { method: "DELETE" });
      if (state.activeTranslation) {
        const result = await api(`/api/translations/${state.activeTranslation.id}`);
        state.activeTranslation = result.translation;
        state.comments = result.comments || [];
        renderTranslationDetail();
      }
      await Promise.all([loadAdminReports(), loadCatalog(true)]);
      toast("تم حذف التعليق.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  $("#year").textContent = new Date().getFullYear();
  $("#catalog-search").addEventListener("input", renderCatalog);
  $$('[data-filter]').forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    $$('[data-filter]').forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
    renderCatalog();
  }));
  $$('[data-close]').forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.close)));
  $$("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
  $$('[data-auth-tab]').forEach((button) => button.addEventListener("click", () => setAuthTab(button.dataset.authTab)));
  $$('[data-auth-tab-link]').forEach((button) => button.addEventListener("click", () => setAuthTab(button.dataset.authTabLink)));
  $$('[data-admin-tab]').forEach((button) => button.addEventListener("click", () => setAdminTab(button.dataset.adminTab)));
  $$('[data-invoice-filter]').forEach((button) => button.addEventListener("click", () => {
    state.adminInvoiceFilter = button.dataset.invoiceFilter;
    $$('[data-invoice-filter]').forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
    renderAdminInvoices();
  }));
  $("#login-form").addEventListener("submit", (event) => submitAuth(event, "login"));
  $("#register-form").addEventListener("submit", (event) => submitAuth(event, "register"));
  $("#recover-form").addEventListener("submit", submitRecovery);
  $("#account-button").addEventListener("click", openAccount);
  $("#notification-button").addEventListener("click", openNotifications);
  $("#privacy-button").addEventListener("click", () => showDialog("privacy-dialog"));
  $("#translation-request-button").addEventListener("click", () => openTranslationRequest().catch((error) => toast(error.message, "error")));
  $("#vip-support-button").addEventListener("click", () => openVipSupport().catch((error) => toast(error.message, "error")));
  $("#invoice-shortcut").addEventListener("click", () => openVipSupport().catch((error) => toast(error.message, "error")));
  $("#admin-button").addEventListener("click", openAdmin);
  $("#logout-button").addEventListener("click", logout);
  $("#account-form").addEventListener("submit", updateAccount);
  $("#recovery-code-form").addEventListener("submit", generateRecoveryCode);
  $("#copy-recovery-code").addEventListener("click", copyRecoveryCode);
  $("#confirm-recovery-code").addEventListener("click", confirmRecoveryCodeSaved);
  $("#translation-request-form").addEventListener("submit", submitTranslationRequest);
  $("#translation-form").addEventListener("submit", saveTranslation);
  $("#news-form").addEventListener("submit", saveNews);
  $("#invoice-form").addEventListener("submit", submitPaypalInvoice);
  $("#cancel-edit").addEventListener("click", resetTranslationForm);
  $("#cancel-news-edit").addEventListener("click", resetNewsForm);
  $("#translation-form").elements.cover.addEventListener("change", (event) => updateFileLabel(event.currentTarget));
  $("#translation-form").elements.gallery.addEventListener("change", (event) => updateFileLabel(event.currentTarget));
  $("#news-form").elements.newsCover.addEventListener("change", (event) => updateFileLabel(event.currentTarget));
  $("#translation-request-form").elements.requestImage.addEventListener("change", (event) => updateFileLabel(event.currentTarget));
  $("#translation-form").elements.downloadFile.addEventListener("change", (event) => {
    updateFileLabel(event.currentTarget);
    syncDownloadFields();
  });
  $("#translation-form").elements.access.addEventListener("change", syncDownloadFields);
  $("#translation-dialog").addEventListener("close", () => {
    state.detailRequest += 1;
    state.activeTranslation = null;
    state.activeTranslationReference = null;
    state.comments = [];
    state.replyingTo = null;
    document.title = "تعريبات Zx87s";
    clearTranslationRoute();
  });
  $("#image-dialog").addEventListener("close", () => {
    $("#lightbox-image").removeAttribute("src");
  });

  setIconText($("#logout-button"), "logout", "خروج");
  setIconText($("#account-form button[type=submit]"), "save", "حفظ");
  setIconText($("#recovery-code-form button[type=submit]"), "key", "إنشاء رمز استرداد جديد");
  setIconText($("#copy-recovery-code"), "copy", "نسخ الرمز");
  setIconText($("#translation-request-button"), "gamepad", "طلبات التعريب");
  setIconText($("#translation-request-form button[type=submit]"), "gamepad", "إرسال الطلب");
  setIconText($("#translation-form button[type=submit]"), "save", "حفظ التعريب");
  setIconText($("#news-form button[type=submit]"), "news", "نشر الخبر");
  setIconText($("#invoice-form button[type=submit]"), "receipt", "إرسال للمراجعة");
  const adminTabIcons = { translations: "download", news: "news", invoices: "receipt", users: "user", requests: "gamepad", reports: "flag" };
  $$('[data-admin-tab]').forEach((button) => setIconText(button, adminTabIcons[button.dataset.adminTab], button.textContent));
  $$(".file-button").forEach((node) => setIconText(node, "upload", node.textContent));
  $("#translation-form").elements.publishedAt.value = toDateTimeLocal(new Date());
  enhancePasswordInputs();
  syncDownloadFields();
  hydratePublicCache();
  updateHeader();
  renderCatalog();
  renderNews();
  syncTranslationFromLocation();
  window.setInterval(() => {
    if (state.user && document.visibilityState === "visible") loadNotifications().catch(() => {});
  }, 60_000);
  window.addEventListener("popstate", syncTranslationFromLocation);
  Promise.all([loadCatalog(), loadNews(), restoreSession()]).then(syncTranslationFromLocation);
})();
