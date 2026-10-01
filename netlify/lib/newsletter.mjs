/*
 * Newsletter draft campaigns for Orvix Perspectives (Node built-ins only).
 *
 * Used by netlify/functions/blog.mjs: when a post is published for the first
 * time, createNewsletterDrafts() fills the email templates in /email and
 * creates one DRAFT email campaign per language in Brevo. Nothing is ever
 * sent from here; an editor reviews the draft in Brevo and sends it by hand.
 *
 * Lives outside netlify/functions so Netlify does not deploy it as a
 * function of its own; esbuild bundles it into blog.mjs. The templates are
 * shipped with the function via netlify.toml [functions] included_files.
 *
 * Env:
 *   BREVO_API_KEY          Brevo API key (needs Campaigns permission)
 *   NEWSLETTER_FROM_EMAIL  sender / reply-to address (verified in Brevo)
 *   NEWSLETTER_FROM_NAME   optional sender name (default "Orvix")
 *   SITE_URL               e.g. https://orvixnet.com (links + images in the email)
 *   BREVO_LIST_ID          English subscriber list id
 *   BREVO_LIST_ID_AR       optional Arabic subscriber list id (no Arabic draft without it)
 */

import fs from "node:fs/promises";
import path from "node:path";

const LANGS = ["en", "ar"];
const TEMPLATE_FILES = { en: "perspectives-newsletter.html", ar: "perspectives-newsletter-ar.html" };
const INTRO = { en: "A new piece from Orvix Perspectives.", ar: "مقال جديد من وجهات نظر Orvix." };
const USER_AGENT = "orvix-site/1.0"; // Brevo's Cloudflare blocks some default agents
const LIST_ID_RE = /^[1-9]\d{0,9}$/;

const escHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Fill a template:
 *  - documentation comments that mention template tags ({{ }} or {% %}) are
 *    removed, so Brevo's template engine never sees stray tags in comments
 *    (Outlook conditional comments <!--[if ...]> are kept untouched);
 *  - every {% if params.ALSO_TITLE %}...{% endif %} block is removed;
 *  - every {{ params.KEY }} becomes the HTML-escaped value (unknown -> "").
 * {{ unsubscribe }} and {{ mirror }} are left for Brevo to fill.
 */
export function fillTemplate(html, values = {}) {
  return String(html)
    .replace(/<!--(?!\[if|>|<!\[endif)([\s\S]*?)-->/g, (m, body) => (/\{\{|\{%/.test(body) ? "" : m))
    .replace(/\{%\s*if\s+params\.ALSO_TITLE\s*%\}[\s\S]*?\{%\s*endif\s*%\}/g, "")
    .replace(/\{\{\s*params\.([A-Za-z0-9_]+)\s*\}\}/g, (_, key) =>
      values[key] === undefined || values[key] === null ? "" : escHtml(values[key]),
    );
}

/**
 * Load the template for a language: from the function bundle (cwd/email or
 * next to this module), falling back to the deployed site copy.
 */
export async function loadTemplate(lang, { readFile = fs.readFile, fetchImpl = globalThis.fetch, siteUrl = "" } = {}) {
  const file = TEMPLATE_FILES[lang];
  if (!file) throw new Error(`no template for language ${lang}`);
  const candidates = [path.join(process.cwd(), "email", file)];
  try {
    candidates.push(new URL("../../email/" + file, import.meta.url));
  } catch {
    /* import.meta.url unusable in this bundle */
  }
  for (const c of candidates) {
    try {
      const html = await readFile(c, "utf8");
      if (typeof html === "string" && html) return html;
      if (html && typeof html.toString === "function" && html.length) return html.toString("utf8");
    } catch {
      /* try next */
    }
  }
  if (siteUrl && fetchImpl) {
    try {
      const res = await fetchImpl(`${siteUrl}/email/${file}`, { headers: { "User-Agent": USER_AGENT } });
      if (res.status === 200) return await res.text();
    } catch {
      /* fall through */
    }
  }
  throw new Error(`email template ${file} not found`);
}

/** POST one campaign; returns {ok, id} or {ok:false, status, message}. Network errors throw. */
async function postCampaign(fetchImpl, apiKey, campaign) {
  const res = await fetchImpl("https://api.brevo.com/v3/emailCampaigns", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(campaign),
  });
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text */
  }
  if (res.status === 201) return { ok: true, id: data?.id ?? null };
  const message = String(data?.message || text || `HTTP ${res.status}`).trim().slice(0, 200);
  return { ok: false, status: res.status, message };
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Create one draft campaign per language that has text and a list.
 * Never throws; returns {created:[{lang,id,list}], skipped:[{lang,reason}], errors:[{lang,message}]}.
 */
export async function createNewsletterDrafts({ post, env = {}, fetchImpl = globalThis.fetch, readFile, now = Date.now }) {
  const result = { created: [], skipped: [], errors: [] };
  const get = (k) => (typeof env[k] === "string" ? env[k].trim() : "");
  const apiKey = get("BREVO_API_KEY");
  const fromEmail = get("NEWSLETTER_FROM_EMAIL");
  const fromName = get("NEWSLETTER_FROM_NAME") || "Orvix";
  const siteUrl = get("SITE_URL").replace(/\/+$/, "");
  if (!apiKey || !fromEmail || !siteUrl) {
    for (const lang of LANGS) result.skipped.push({ lang, reason: "not configured" });
    return result;
  }
  const listIds = { en: get("BREVO_LIST_ID"), ar: get("BREVO_LIST_ID_AR") };
  const date = new Date(now()).toISOString().slice(0, 10);
  const slug = str(post?.slug);
  const cover = str(post?.cover);
  const coverUrl =
    cover.startsWith("/") && !cover.startsWith("//") ? siteUrl + cover : `${siteUrl}/images/hero-perspectives.jpg`;

  for (const lang of LANGS) {
    try {
      const title = str(post?.title?.[lang]);
      const body = str(post?.body?.[lang]);
      if (!title || !body) {
        result.skipped.push({ lang, reason: `no ${lang === "ar" ? "Arabic" : "English"} text` });
        continue;
      }
      if (!LIST_ID_RE.test(listIds[lang])) {
        result.skipped.push({ lang, reason: "no list id" });
        continue;
      }
      const summary = str(post?.summary?.[lang]) || str(post?.summary?.en);
      const articleUrl = `${siteUrl}${lang === "ar" ? "/ar" : ""}/research/perspectives/${slug}/`;
      const template = await loadTemplate(lang, { readFile, fetchImpl, siteUrl });
      const htmlContent = fillTemplate(template, {
        PREHEADER: summary,
        INTRO: INTRO[lang],
        ARTICLE_TITLE: title,
        ARTICLE_SUMMARY: summary,
        ARTICLE_URL: articleUrl,
        COVER_URL: coverUrl,
      });
      const campaign = {
        name: `Perspectives · ${title} (${lang.toUpperCase()}) · ${date}`,
        subject: title,
        previewText: summary.slice(0, 150),
        sender: { name: fromName, email: fromEmail },
        replyTo: fromEmail,
        htmlContent,
        recipients: { listIds: [Number(listIds[lang])] },
        mirrorActive: true,
      };
      let r = await postCampaign(fetchImpl, apiKey, campaign);
      if (r.ok) {
        result.created.push({ lang, id: r.id, list: true });
        continue;
      }
      // Brevo says "no contacts associated" when the list looks empty, and its
      // counts lag behind new subscribers. Create the draft without a list
      // instead; marketing picks the list in Brevo before sending.
      if (r.status === 400 && /no contacts associated/i.test(r.message)) {
        const { recipients, ...withoutList } = campaign;
        r = await postCampaign(fetchImpl, apiKey, withoutList);
        if (r.ok) {
          result.created.push({ lang, id: r.id, list: false });
          continue;
        }
      }
      result.errors.push({ lang, message: r.message });
    } catch (err) {
      result.errors.push({ lang, message: String(err?.message || err).slice(0, 200) });
    }
  }
  return result;
}
