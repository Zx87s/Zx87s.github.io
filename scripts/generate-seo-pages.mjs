#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const API_URL = process.env.ZX87S_TRANSLATIONS_API || "https://ta3reebat-memberships.zx87s.chatgpt.site/api/translations";
const SITE_ORIGIN = "https://zx87s.github.io";
const BACKEND_ORIGIN = "https://ta3reebat-memberships.zx87s.chatgpt.site";
const MARKER = ".generated-by-zx87s-seo";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function html(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function xml(value) {
  return html(value);
}

function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function validSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function safeDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = safeDate(value);
  return date ? new Intl.DateTimeFormat("ar", { dateStyle: "long", timeZone: "UTC" }).format(date) : "";
}

function statusLabel(item) {
  if (item.projectStatus === "upcoming") return "قادم";
  if (item.projectStatus === "in_progress") return `قيد التعريب — ${Number(item.progress) || 0}%`;
  return "متاح للتنزيل";
}

function tags(item) {
  return [
    item.access === "vip" ? "VIP" : "مجاني",
    item.isFeatured ? "مميز" : "",
    item.isNewRelease ? "جديد" : "",
    item.hasNewUpdate ? "تحديث جديد" : "",
    item.isExperimental ? "تجريبي" : "",
  ].filter(Boolean);
}

function descriptionFor(item) {
  const raw = String(item.description || "").replace(/\s+/g, " ").trim();
  return (raw || `حمّل التعريب العربي للعبة ${item.title} من مكتبة تعريبات Zx87s.`).slice(0, 300);
}

function sharedStyles() {
  return `<style>
    :root{color-scheme:dark;--bg:#09090b;--surface:#141416;--line:#2a2a2f;--text:#fafafa;--muted:#aaaab3;--accent:#f06464;--gold:#f8c34a}*{box-sizing:border-box}html{font-family:Tahoma,Arial,sans-serif;background:var(--bg);color:var(--text);scroll-behavior:smooth}body{margin:0;min-height:100vh;background:radial-gradient(circle at 80% 0,rgba(112,25,25,.18),transparent 32rem),var(--bg)}a{color:inherit}.shell{width:min(1080px,calc(100% - 32px));margin:auto}.header{display:flex;min-height:76px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{text-decoration:none;font-weight:900;font-size:1.15rem}.brand b{color:var(--accent)}.back{color:var(--muted);text-decoration:none}.back:hover{color:var(--text)}main{padding:42px 0 72px}.hero{display:grid;grid-template-columns:minmax(280px,.9fr) minmax(0,1.1fr);gap:36px;align-items:start}.cover{width:100%;aspect-ratio:16/10;object-fit:cover;border:1px solid var(--line);border-radius:22px;background:#1f1f23}.placeholder{display:grid;place-items:center;color:var(--muted)}.eyebrow{margin:0 0 10px;color:var(--accent);font-weight:900}.title{margin:0;font-size:clamp(2rem,6vw,4.1rem);line-height:1.12}.desc{margin:20px 0;color:#d0d0d5;font-size:1.05rem;line-height:1.9;white-space:pre-line}.badges{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0}.badge{padding:7px 11px;border:1px solid var(--line);border-radius:999px;background:#19191c;color:#d6d6dc;font-size:.86rem;font-weight:800}.badge.vip{border-color:#806321;color:var(--gold)}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:24px 0}.meta div{padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.meta small{display:block;margin-bottom:5px;color:var(--muted)}.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;border-radius:12px;background:#7c2020;color:white;text-decoration:none;font-weight:900}.gallery{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:42px}.gallery img{width:100%;aspect-ratio:16/10;object-fit:cover;border:1px solid var(--line);border-radius:14px}.section-title{margin:0 0 22px}.library{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{display:block;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--surface);text-decoration:none}.card img{width:100%;aspect-ratio:16/10;object-fit:cover;background:#202024}.card div{padding:16px}.card h2{margin:0;font-size:1.05rem}.card p{margin:8px 0 0;color:var(--muted);font-size:.9rem}.footer{padding:28px 0;border-top:1px solid var(--line);color:var(--muted);text-align:center}@media(max-width:760px){.hero{grid-template-columns:1fr}.library{grid-template-columns:1fr 1fr}.gallery{display:flex;overflow-x:auto}.gallery img{flex:0 0 80%}}@media(max-width:460px){.library{grid-template-columns:1fr}.meta{grid-template-columns:1fr}}
  </style>`;
}

function pageHead({ title, description, canonical, image, type = "article", structuredData }) {
  const imageTags = image ? `<meta property="og:image" content="${html(image)}"><meta property="og:image:alt" content="${html(title)}"><meta name="twitter:image" content="${html(image)}">` : "";
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><meta name="description" content="${html(description)}"><meta name="robots" content="index,follow,max-image-preview:large"><meta name="theme-color" content="#09090b"><link rel="canonical" href="${html(canonical)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta property="og:locale" content="ar_AR"><meta property="og:type" content="${type}"><meta property="og:site_name" content="تعريبات Zx87s"><meta property="og:title" content="${html(title)}"><meta property="og:description" content="${html(description)}"><meta property="og:url" content="${html(canonical)}">${imageTags}<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${html(title)}"><meta name="twitter:description" content="${html(description)}"><link rel="preconnect" href="${BACKEND_ORIGIN}" crossorigin>${sharedStyles()}<script type="application/ld+json">${jsonLd(structuredData)}</script>`;
}

function translationPage(item) {
  const canonical = `${SITE_ORIGIN}/translations/${encodeURIComponent(item.slug)}/`;
  const appUrl = `${SITE_ORIGIN}/?game=${encodeURIComponent(item.slug)}`;
  const title = `${item.title} – التعريب العربي | Zx87s`;
  const description = descriptionFor(item);
  const datePublished = safeDate(item.publishedAt)?.toISOString();
  const dateModified = safeDate(item.updatedAt)?.toISOString();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `تعريب ${item.title}`,
    alternateName: item.title,
    applicationCategory: "GameApplication",
    operatingSystem: "Windows",
    inLanguage: "ar",
    description,
    url: canonical,
    ...(item.coverUrl ? { image: item.coverUrl } : {}),
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : {}),
    author: { "@type": "Organization", name: "Zx87s", url: SITE_ORIGIN },
  };
  const cover = item.coverUrl
    ? `<img class="cover" src="${html(item.coverUrl)}" alt="صورة لعبة ${html(item.title)}" width="960" height="600" fetchpriority="high">`
    : `<div class="cover placeholder">لا توجد صورة</div>`;
  const gallery = Array.isArray(item.galleryUrls) && item.galleryUrls.length
    ? `<section aria-labelledby="gallery-title"><h2 class="section-title" id="gallery-title">صور التعريب داخل اللعبة</h2><div class="gallery">${item.galleryUrls.slice(0, 4).map((url, index) => `<a href="${html(url)}"><img src="${html(url)}" alt="${html(item.title)} — الصورة ${index + 1}" width="640" height="400" loading="lazy"></a>`).join("")}</div></section>`
    : "";
  const tagHtml = tags(item).map((tag, index) => `<span class="badge${index === 0 && item.access === "vip" ? " vip" : ""}">${html(tag)}</span>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head>${pageHead({ title, description, canonical, image: item.coverUrl, structuredData })}</head><body><header><div class="shell header"><a class="brand" href="/"><span>تعريبات </span><b>Zx87s</b></a><a class="back" href="/translations/">كل التعريبات</a></div></header><main class="shell"><article class="hero">${cover}<div><p class="eyebrow">تعريب عربي للعبة</p><h1 class="title">${html(item.title)}</h1><div class="badges">${tagHtml}</div><p class="desc">${html(description)}</p><div class="meta"><div><small>حالة التعريب</small><strong>${html(statusLabel(item))}</strong></div><div><small>الفئة</small><strong>${item.access === "vip" ? "VIP" : "مجاني"}</strong></div>${item.genre ? `<div><small>نوع اللعبة</small><strong>${html(item.genre)}</strong></div>` : ""}${item.releaseYear ? `<div><small>سنة الإصدار</small><strong>${html(item.releaseYear)}</strong></div>` : ""}<div><small>تاريخ النشر</small><strong>${html(formatDate(item.publishedAt))}</strong></div><div><small>التحميلات</small><strong>${Number(item.downloadCount) || 0}</strong></div></div><a class="button" href="${html(appUrl)}">فتح التعريب والتعليقات</a></div></article>${gallery}</main><footer class="footer"><div class="shell">تعريبات Zx87s</div></footer></body></html>`;
}

function libraryPage(items) {
  const canonical = `${SITE_ORIGIN}/translations/`;
  const title = "جميع التعريبات العربية | Zx87s";
  const description = "تصفح جميع تعريبات الألعاب العربية المنشورة في مكتبة تعريبات Zx87s.";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: canonical,
    mainEntity: { "@type": "ItemList", itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.title, url: `${SITE_ORIGIN}/translations/${item.slug}/` })) },
  };
  const cards = items.map((item) => `<a class="card" href="/translations/${encodeURIComponent(item.slug)}/">${item.coverUrl ? `<img src="${html(item.coverUrl)}" alt="${html(item.title)}" width="640" height="400" loading="lazy">` : `<div class="cover placeholder">لا توجد صورة</div>`}<div><h2>${html(item.title)}</h2><p>${item.access === "vip" ? "VIP" : "مجاني"} · ${html(statusLabel(item))}</p></div></a>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head>${pageHead({ title, description, canonical, image: items.find((item) => item.coverUrl)?.coverUrl || null, type: "website", structuredData })}</head><body><header><div class="shell header"><a class="brand" href="/"><span>تعريبات </span><b>Zx87s</b></a><a class="back" href="/">الرئيسية</a></div></header><main class="shell"><h1 class="section-title">جميع التعريبات</h1><div class="library">${cards}</div></main><footer class="footer"><div class="shell">تعريبات Zx87s</div></footer></body></html>`;
}

async function readTranslations() {
  const input = arg("--input");
  if (input) return JSON.parse(await readFile(resolve(input), "utf8"));
  const response = await fetch(API_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Translation API returned ${response.status}`);
  return response.json();
}

async function main() {
  const output = resolve(arg("--output") || process.cwd());
  const payload = await readTranslations();
  const rows = Array.isArray(payload) ? payload : payload.translations;
  if (!Array.isArray(rows)) throw new Error("Translation API response is invalid");
  const items = rows.filter((item) => validSlug(item?.slug) && typeof item?.title === "string" && item.title.trim()).slice(0, 10_000);
  const translationsDir = join(output, "translations");
  if (existsSync(translationsDir)) {
    const marker = join(translationsDir, MARKER);
    if (!existsSync(marker)) throw new Error(`Refusing to replace unmanaged directory: ${translationsDir}`);
    await rm(translationsDir, { recursive: true, force: true });
  }
  await mkdir(translationsDir, { recursive: true });
  await writeFile(join(translationsDir, MARKER), "Generated automatically. Do not edit.\n", "utf8");
  await writeFile(join(translationsDir, "index.html"), libraryPage(items), "utf8");
  for (const item of items) {
    const directory = join(translationsDir, item.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), translationPage(item), "utf8");
  }
  const urls = [
    { loc: `${SITE_ORIGIN}/`, lastmod: null },
    { loc: `${SITE_ORIGIN}/translations/`, lastmod: null },
    ...items.map((item) => ({ loc: `${SITE_ORIGIN}/translations/${encodeURIComponent(item.slug)}/`, lastmod: safeDate(item.updatedAt || item.publishedAt)?.toISOString().slice(0, 10) || null })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(({ loc, lastmod }) => `  <url><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
  await writeFile(join(output, "sitemap.xml"), sitemap, "utf8");
  await writeFile(join(output, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`, "utf8");
  const catalogUpdatedAt = items
    .map((item) => safeDate(item.updatedAt || item.publishedAt)?.toISOString() || "")
    .sort()
    .at(-1) || null;
  await writeFile(join(output, "seo-status.json"), `${JSON.stringify({ catalogUpdatedAt, translationCount: items.length }, null, 2)}\n`, "utf8");
  console.log(`Generated ${items.length} translation pages in ${output}`);
}

await main();
