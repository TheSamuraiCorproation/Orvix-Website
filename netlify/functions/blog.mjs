/*
 * Orvix blog admin API  (Netlify Function, Node 20+, no dependencies)
 * ===================================================================
 *
 * WHAT IT DOES
 *   Server side of the blog admin at /admin/. Editors sign in with an email
 *   magic link. Blog posts are JSON files in this site's GitHub repository;
 *   saving a post commits the file, and Netlify rebuilds the site on every
 *   commit, so a published post goes live a minute or two later.
 *   Endpoints (all JSON unless noted):
 *
 *     POST   /api/login          body {"email": "..."} -> always {"ok": true}; emails a link if allowed
 *     GET    /api/login/verify?token=...   -> 302 /admin/ with session cookie, or 302 /admin/?signin=expired
 *     POST   /api/logout         -> {"ok": true}, clears the session cookie
 *     POST   /api/subscribe      PUBLIC newsletter form, body {"email", "lang": "en"|"ar", "sector"?, "company": ""}
 *                                 -> {"ok": true, "confirm": true|false}  (see NEWSLETTER below)
 *     GET    /api/me             -> {"email": "..."} | 401
 *     GET    /api/posts          -> {"posts": [summary, ...]}  newest updated first
 *     GET    /api/posts/<slug>   -> full post | 404
 *     PUT    /api/posts/<slug>   body {"post": {...}, "cover_upload": {"type":"image/webp","data":"<base64>"} | null}
 *                                 -> {"ok": true, "post": <saved>, "url": "/research/perspectives/<slug>/"}
 *     DELETE /api/posts/<slug>   -> {"ok": true}   (removes the JSON and the cover)
 *
 *   Files written:  content/posts/<slug>.json   and   images/posts/<slug>.webp
 *
 * ENVIRONMENT VARIABLES (Netlify > Site configuration > Environment variables; redeploy after changes)
 *   SESSION_SECRET     at least 32 random characters; HMAC-SHA256 key for the
 *                      sign-in links and session cookies. Generate with e.g.
 *                      node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
 *   ADMIN_EMAILS       comma-separated editor emails allowed to sign in (any domain)
 *   SITE_URL           public site address, e.g. https://orvixnet.com (used in the emailed link)
 *   BREVO_API_KEY      Brevo transactional email API key (Brevo > SMTP & API > API keys)
 *   MAIL_FROM_EMAIL    sender address, must be a verified sender/domain in Brevo
 *   GITHUB_TOKEN       fine-grained GitHub token: this one repo only,
 *                      permission "Contents: Read and write", nothing else
 *   GITHUB_REPO        "owner/name", e.g. "TheSamuraiCorproation/Orvix-Website"
 *   Optional:
 *   MAIL_FROM_NAME     sender name (default "Orvix")
 *   GITHUB_BRANCH      branch to commit to (default "main")
 *   BLOG_COMMIT_EMAIL  commit author email (default "blog@orvixnet.com")
 *
 *   If any required variable is missing or invalid (SESSION_SECRET shorter
 *   than 32 characters, ADMIN_EMAILS empty, SITE_URL not an http(s) URL)
 *   every request fails closed with 503 {"error":"Admin is not configured"}.
 *   (Exception: /api/subscribe only needs the newsletter variables below.)
 *
 * NEWSLETTER DRAFTS (automatic, never sent)
 *   When PUT /api/posts/<slug> publishes a post for the first time (status
 *   "published" and it was not published before), after the GitHub save
 *   succeeds, netlify/lib/newsletter.mjs fills email/perspectives-newsletter
 *   (-ar).html and creates one DRAFT email campaign per language in Brevo.
 *   An editor reviews and sends it from Brevo by hand. A language is skipped
 *   when the post has no title/body in it or its list id is not set. Failures
 *   never fail the save; the 200 response then carries
 *   "newsletter": {created:[{lang,id,list}], skipped:[{lang,reason}], errors:[{lang,message}]}
 *   (the key is absent when no draft was attempted, e.g. re-saving a live post).
 *   Env: BREVO_API_KEY (needs Campaigns permission), NEWSLETTER_FROM_EMAIL
 *   (verified sender, also reply-to), NEWSLETTER_FROM_NAME (optional, default
 *   "Orvix"), SITE_URL, BREVO_LIST_ID (English list), BREVO_LIST_ID_AR
 *   (optional Arabic list). Without BREVO_API_KEY / NEWSLETTER_FROM_EMAIL /
 *   SITE_URL every language is skipped as "not configured".
 *
 * NEWSLETTER (POST /api/subscribe, public, no session)
 *   BREVO_API_KEY          same Brevo key as above (needs Contacts permission)
 *   BREVO_LIST_ID          numeric id of the Brevo contact list to add subscribers to
 *   BREVO_LIST_ID_AR       optional numeric id of the Arabic list; when valid,
 *                          subscribers with lang "ar" go there instead
 *   BREVO_DOI_TEMPLATE_ID  optional numeric id of a Brevo double opt-in template.
 *                          When set, Brevo emails a confirmation link and only adds
 *                          the contact after the click (redirect to
 *                          SITE_URL[/ar]/research/subscribe/?confirmed=1; SITE_URL is
 *                          then required). When unset, contacts are added directly.
 *   If BREVO_API_KEY / BREVO_LIST_ID are missing or invalid, only this route
 *   answers 503 {"error":"Subscriptions are not available right now."}; it works
 *   even when the admin variables are absent.
 *   Abuse protection: header "X-Orvix-Form: 1", JSON Content-Type and same
 *   Origin (else 403), 10 KB body limit, a "company" honeypot field (filled ->
 *   silently 200 without calling Brevo), and a best-effort in-memory throttle
 *   of 5 requests per IP and 3 per email per 15 minutes (throttled -> 200, no
 *   Brevo call). The email is never echoed back in responses.
 *
 * HOW LOGIN WORKS
 *   1. The editor types their email on /admin/; the page POSTs /api/login.
 *      The answer is always 200 {"ok":true}, so nobody can probe which
 *      addresses are editors. Only if the address is in ADMIN_EMAILS (and the
 *      per-email / per-IP throttle of 5 requests per 15 minutes allows it) a
 *      link is emailed through Brevo:
 *        SITE_URL/api/login/verify?token=<login token, valid 15 minutes>
 *   2. Clicking the link hits GET /api/login/verify. If the token is valid
 *      and the email is still in ADMIN_EMAILS, the response sets the session
 *      cookie "__Host-orvix_admin" (HttpOnly, Secure, SameSite=Strict, 8 h)
 *      and redirects to /admin/.
 *   3. Every other /api route (except login/logout) needs that cookie, and
 *      the email inside it must still be in ADMIN_EMAILS, so removing an
 *      address from ADMIN_EMAILS (and redeploying) locks that person out at once.
 *
 *   Tokens are compact JWT-style strings: base64url(header).base64url(payload).
 *   base64url(HMAC-SHA256(SESSION_SECRET, header.payload)). Only alg HS256 is
 *   accepted, signatures are compared in constant time, and each token has a
 *   "typ" ("login" or "session") so a sign-in link can never be used as a
 *   session cookie or the other way round.
 *
 *   Why SameSite=Strict still works with an emailed link: the click from the
 *   mail client (e.g. webmail on another site) is a cross-site top-level
 *   navigation. Browsers do store Strict cookies set by the response to a
 *   top-level navigation (SameSite limits when a cookie is SENT, not when a
 *   top-level response may SET it). Verify does not need any cookie because
 *   it reads the token from the URL. The 302 to /admin/ is still part of the
 *   cross-site redirect chain, so that one HTML request may go out without
 *   the cookie, which is fine because /admin/ is a static page. The admin
 *   page's own fetch() calls to /api/* are same-origin, so the browser sends
 *   the cookie with them. (Do not put a server-side cookie check on the
 *   /admin/ HTML itself, or the first load after clicking the link would fail.)
 *   Because of the "__Host-" prefix and Secure flag the cookie only works on
 *   https (and http://localhost in modern browsers).
 *
 *   Writes (PUT/DELETE) and POST login/logout also need the header
 *   "X-Orvix-Admin: 1", a JSON Content-Type and, if the browser sends Origin,
 *   the same origin (CSRF protection). Request bodies over 6 MB are refused.
 *   Auth failures return 401 {"error":"Not signed in"}; the reason is only
 *   written to the function log (console.warn).
 *
 * ROTATING SESSION_SECRET
 *   Replace the value in Netlify and redeploy. Every session cookie and every
 *   unused sign-in link becomes invalid at once, so all editors are signed
 *   out and simply request a new link. Do this if the secret may have leaked.
 *
 * ROTATING THE GITHUB TOKEN
 *   1. GitHub > Settings > Developer settings > Fine-grained tokens >
 *      Generate new token: resource owner = the org, "Only select
 *      repositories" = Orvix-Website, Repository permissions > Contents =
 *      Read and write. Pick an expiry (e.g. 90 days) and put a reminder in
 *      the calendar.
 *   2. Netlify > Environment variables > GITHUB_TOKEN > replace the value.
 *   3. Redeploy (Deploys > Trigger deploy) so functions pick up the value.
 *   4. Open /admin/, save a draft to check, then revoke the old token on GitHub.
 *   If the token expires, saving fails with "Could not reach the site
 *   storage" and the log says "GitHub rejected the token".
 *
 * ROTATING THE BREVO KEY
 *   Create a new key in Brevo, replace BREVO_API_KEY, redeploy, delete the old key.
 *
 * TESTS
 *   node --test "netlify/functions/*.test.mjs"
 *   Pure helpers are exported below so they can be tested without network.
 */

import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { createNewsletterDrafts } from "../lib/newsletter.mjs";

// Netlify: serve this function at /api/* directly (a /api/* -> function
// rewrite in _redirects works as well; route parsing handles both).
export const config = { path: "/api/*" };

// ---------------------------------------------------------------- constants

export const MAX_BODY_BYTES = 6 * 1024 * 1024;
export const MAX_COVER_BYTES = 3 * 1024 * 1024;
const MAX_LOGIN_BODY_BYTES = 4 * 1024;
const MAX_SUBSCRIBE_BODY_BYTES = 10 * 1024;
// the Subscribe page's optional sector choices, saved to the Brevo SECTOR attribute
export const SECTORS = ["Financial services", "Government & public sector", "Energy & utilities",
  "Telecommunications", "Healthcare", "Other"];
const MAX_LIST_FILES = 200;
export const LOGIN_TTL_S = 15 * 60;
export const SESSION_TTL_S = 8 * 60 * 60;
export const SESSION_COOKIE = "__Host-orvix_admin";
const CLOCK_SKEW_S = 60;
const THROTTLE_MAX = 5;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const LIMITS = { title: 120, summary: 300, body: 50000, cover_alt: 200, author: 80 };
const LANGS = ["en", "ar"];

// ---------------------------------------------------------------- responses

const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

function redirect(location, extraHeaders = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      ...BASE_HEADERS,
      Location: location,
      // The URL carried a sign-in token; never leak it in a Referer.
      "Referrer-Policy": "no-referrer",
      ...extraHeaders,
    },
  });
}

/** Error carrying an HTTP status and a safe, user-facing message. */
export class HttpError extends Error {
  constructor(status, message, logReason) {
    super(message);
    this.status = status;
    this.logReason = logReason;
  }
}

// ---------------------------------------------------------------- config

/** Read and validate configuration. Returns null when not configured (fail closed). */
export function readConfig(env) {
  const get = (k) => (typeof env[k] === "string" ? env[k].trim() : "");
  const secret = get("SESSION_SECRET");
  const admins = get("ADMIN_EMAILS")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const siteUrl = get("SITE_URL").replace(/\/+$/, "");
  const brevoKey = get("BREVO_API_KEY");
  const fromEmail = get("MAIL_FROM_EMAIL");
  const token = get("GITHUB_TOKEN");
  const repo = get("GITHUB_REPO");
  if (secret.length < 32 || admins.length === 0 || !siteUrl || !brevoKey || !fromEmail || !token || !repo) {
    return null;
  }
  try {
    const u = new URL(siteUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return {
    secret,
    admins,
    siteUrl,
    mail: { apiKey: brevoKey, fromEmail, fromName: get("MAIL_FROM_NAME") || "Orvix" },
    github: {
      token,
      repo,
      branch: get("GITHUB_BRANCH") || "main",
      commitEmail: get("BLOG_COMMIT_EMAIL") || "blog@orvixnet.com",
    },
  };
}

// ---------------------------------------------------------------- routing

/**
 * Turn a request path into a route.
 * Returns {name: "login"|"verify"|"logout"|"me"|"posts"} | {name: "post", slug} | null.
 * The slug is returned raw; callers validate it with isValidSlug.
 */
export function parseRoute(pathname) {
  let p = pathname || "/";
  for (const prefix of ["/.netlify/functions/blog", "/api"]) {
    if (p === prefix || p.startsWith(prefix + "/")) {
      p = p.slice(prefix.length);
      break;
    }
  }
  p = p.replace(/\/+$/, "") || "/";
  if (p === "/login") return { name: "login" };
  if (p === "/login/verify") return { name: "verify" };
  if (p === "/logout") return { name: "logout" };
  if (p === "/subscribe") return { name: "subscribe" };
  if (p === "/me") return { name: "me" };
  if (p === "/posts") return { name: "posts" };
  const m = /^\/posts\/([^/]+)$/.exec(p);
  if (m) {
    let slug;
    try {
      slug = decodeURIComponent(m[1]);
    } catch {
      slug = "";
    }
    return { name: "post", slug };
  }
  return null;
}

const ROUTE_METHODS = {
  login: ["POST"],
  verify: ["GET"],
  logout: ["POST"],
  subscribe: ["POST"],
  me: ["GET"],
  posts: ["GET"],
  post: ["GET", "PUT", "DELETE"],
};

export function isValidSlug(slug) {
  return typeof slug === "string" && slug.length > 0 && slug.length <= 80 && SLUG_RE.test(slug);
}

// ---------------------------------------------------------------- signed tokens (HS256)

const TOKEN_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

function hmac(secret, data) {
  return crypto.createHmac("sha256", secret).update(data, "ascii").digest();
}

/** Sign a payload into a compact JWT-style HS256 token. */
export function signToken(payload, secret) {
  const p = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const s = hmac(secret, `${TOKEN_HEADER}.${p}`).toString("base64url");
  return `${TOKEN_HEADER}.${p}.${s}`;
}

function b64urlJson(segment, what) {
  try {
    const v = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new Error(`malformed token ${what}`);
  }
}

/**
 * Verify a token and its type. Throws Error(reason) on any problem, returns
 * the payload (with email lowercased) on success.
 *   expectedTyp  "login" | "session"
 *   nowMs        clock (ms)
 */
export function verifyToken(token, secret, expectedTyp, nowMs = Date.now()) {
  if (typeof token !== "string" || !token) throw new Error("no token");
  if (token.length > 4096) throw new Error("token too long");
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((s) => /^[A-Za-z0-9_-]+$/.test(s))) {
    throw new Error("malformed token");
  }
  const [h, p, s] = parts;
  const header = b64urlJson(h, "header");
  if (header.alg !== "HS256") throw new Error(`alg not allowed: ${String(header.alg)}`);
  const expected = hmac(secret, `${h}.${p}`);
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new Error("bad signature");
  }
  const claims = b64urlJson(p, "payload");
  if (claims.typ !== expectedTyp) throw new Error(`wrong token type ${String(claims.typ)}, expected ${expectedTyp}`);
  const nowS = nowMs / 1000;
  if (typeof claims.exp !== "number" || claims.exp <= nowS) throw new Error("expired");
  if (typeof claims.iat !== "number" || claims.iat - CLOCK_SKEW_S > nowS) throw new Error("bad iat");
  if (typeof claims.email !== "string" || !claims.email.includes("@")) throw new Error("no email");
  return { ...claims, email: claims.email.trim().toLowerCase() };
}

export function createLoginToken(email, secret, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  return signToken(
    { typ: "login", email, iat, exp: iat + LOGIN_TTL_S, nonce: crypto.randomBytes(16).toString("base64url") },
    secret,
  );
}

export function createSessionToken(email, secret, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  return signToken({ typ: "session", email, iat, exp: iat + SESSION_TTL_S }, secret);
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}`;
}
const CLEAR_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function getCookie(req, name) {
  const cookie = req.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/** Check the session cookie. Returns the lowercased email or throws HttpError(401). */
export function authenticate(req, cfg, nowMs = Date.now()) {
  try {
    const claims = verifyToken(getCookie(req, SESSION_COOKIE), cfg.secret, "session", nowMs);
    if (!cfg.admins.includes(claims.email)) throw new Error(`email not in ADMIN_EMAILS: ${claims.email}`);
    return claims.email;
  } catch (err) {
    throw new HttpError(401, "Not signed in", err?.message || String(err));
  }
}

// ---------------------------------------------------------------- login throttle

/**
 * Best-effort, in-memory sliding-window throttle (per function instance, so
 * it resets on cold starts and is not shared between instances). Records the
 * hit and returns true while the key has had at most THROTTLE_MAX hits in
 * the window.
 */
const defaultThrottle = new Map();

export function throttleHit(store, key, nowMs, max = THROTTLE_MAX) {
  if (store.size > 5000) {
    for (const [k, hits] of store) {
      if (!hits.length || hits[hits.length - 1] <= nowMs - THROTTLE_WINDOW_MS) store.delete(k);
    }
  }
  const hits = (store.get(key) || []).filter((t) => t > nowMs - THROTTLE_WINDOW_MS);
  hits.push(nowMs);
  store.set(key, hits);
  return hits.length <= max;
}

// ---------------------------------------------------------------- email (Brevo)

const escHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function sendLoginEmail(cfg, to, link, fetchImpl) {
  const text =
    `Sign in to the Orvix Perspectives admin: ${link}\n\n` +
    "This link works for 15 minutes. If you didn't ask for it, ignore this email.\n";
  const html =
    `<p>Sign in to the Orvix Perspectives admin: <a href="${escHtml(link)}">${escHtml(link)}</a></p>` +
    "<p>This link works for 15 minutes. If you didn't ask for it, ignore this email.</p>";
  try {
    const res = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": cfg.mail.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "orvix-site/1.0",
      },
      body: JSON.stringify({
        sender: { email: cfg.mail.fromEmail, name: cfg.mail.fromName },
        to: [{ email: to }],
        subject: "Your Orvix admin sign-in link",
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      console.warn(`[blog] Brevo send failed (${res.status}): ${detail}`);
    }
  } catch (err) {
    console.warn(`[blog] Brevo send failed: ${err?.message || err}`);
  }
}

/** CSRF checks for state-changing requests. Throws HttpError(403). */
export function checkCsrf(req, headerName = "X-Orvix-Admin") {
  if (req.headers.get(headerName) !== "1") {
    throw new HttpError(403, "Request blocked", `missing ${headerName} header`);
  }
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (!ct.startsWith("application/json")) {
    throw new HttpError(403, "Request blocked", `bad content-type ${ct}`);
  }
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = new Set([new URL(req.url).origin]);
    const host = req.headers.get("host");
    if (host) allowed.add(`https://${host}`);
    if (!allowed.has(origin)) throw new HttpError(403, "Request blocked", `bad origin ${origin}`);
  }
}

/** Read the body with a hard byte cap (413 before parsing). */
export async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const tooBig = new HttpError(413, "This post is too large to save (limit 6 MB). Try a smaller cover image.");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw tooBig;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw tooBig;
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "The data sent was not valid. Reload the page and try again.");
  }
}

// ---------------------------------------------------------------- validation

export function isWebp(buf) {
  return (
    !!buf &&
    buf.length >= 12 &&
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  );
}

/** Decode and check a cover upload. Returns a Buffer or throws HttpError(400). */
export function decodeCover(upload) {
  const bad = (m) => new HttpError(400, m);
  if (!upload || typeof upload !== "object") throw bad("The cover image upload is not valid.");
  if (upload.type !== "image/webp") throw bad("The cover image must be a WebP image.");
  if (typeof upload.data !== "string" || !upload.data) throw bad("The cover image upload is empty.");
  const data = upload.data.replace(/^data:image\/webp;base64,/i, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw bad("The cover image upload is not valid.");
  if (Math.floor((data.length * 3) / 4) > MAX_COVER_BYTES + 3) {
    throw bad("The cover image is too large. It must be 3 MB or smaller.");
  }
  const buf = Buffer.from(data, "base64");
  if (buf.length > MAX_COVER_BYTES) throw bad("The cover image is too large. It must be 3 MB or smaller.");
  if (!isWebp(buf)) throw bad("The cover image is not a real WebP file. Please export it as WebP and try again.");
  return buf;
}

const FIELD_NAMES = {
  title: "title",
  summary: "summary",
  body: "article text",
  cover_alt: "cover image description",
  author: "author",
};
const LANG_NAMES = { en: "English", ar: "Arabic" };

function cleanString(value, max, label) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, `The ${label} must be text.`);
  const s = value.trim();
  if (s.length > max) {
    throw new HttpError(400, `The ${label} is too long (${s.length} characters; the limit is ${max}).`);
  }
  return s;
}

function cleanLangs(obj, field) {
  if (obj !== undefined && obj !== null && (typeof obj !== "object" || Array.isArray(obj))) {
    throw new HttpError(400, `The ${FIELD_NAMES[field]} is not in the expected format.`);
  }
  const out = {};
  for (const lang of LANGS) {
    out[lang] = cleanString(obj?.[lang], LIMITS[field], `${LANG_NAMES[lang]} ${FIELD_NAMES[field]}`);
  }
  return out;
}

export function todayUtc(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Build the object to store from client input. Pure: no I/O.
 *   urlSlug   slug from the URL (authoritative)
 *   input     client "post" object
 *   existing  currently stored post or null
 *   hasNewCover  true when a valid cover upload accompanies the save
 *   nowMs     clock
 * Throws HttpError(400) with an editor-friendly message.
 */
export function validatePost(urlSlug, input, existing, { hasNewCover = false, nowMs = Date.now() } = {}) {
  if (!isValidSlug(urlSlug)) {
    throw new HttpError(
      400,
      "The web address (slug) may only use lowercase letters, numbers and single hyphens, up to 80 characters.",
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "No post was sent. Reload the page and try again.");
  }
  if (input.slug !== urlSlug) {
    throw new HttpError(400, "The post's web address (slug) does not match. Reload the page and try again.");
  }
  if (input.status !== "draft" && input.status !== "published") {
    throw new HttpError(400, "The status must be either draft or published.");
  }

  const title = cleanLangs(input.title, "title");
  const summary = cleanLangs(input.summary, "summary");
  const body = cleanLangs(input.body, "body");
  const cover_alt = cleanLangs(input.cover_alt, "cover_alt");
  const author = cleanString(input.author, LIMITS.author, "author");

  if (input.status === "published") {
    const missing = [];
    if (!title.en) missing.push("English title");
    if (!summary.en) missing.push("English summary");
    if (!body.en) missing.push("English article text");
    if (missing.length) {
      throw new HttpError(400, `To publish, please fill in: ${missing.join(", ")}.`);
    }
  }

  const existingDate =
    existing && typeof existing.published === "string" && /^\d{4}-\d{2}-\d{2}$/.test(existing.published)
      ? existing.published
      : null;
  let published = existingDate;
  if (!published && input.status === "published") published = todayUtc(nowMs);

  const coverPath = `/images/posts/${urlSlug}.webp`;
  // Never accept a client-chosen cover path: only the canonical one, and only
  // when it was just uploaded or was already stored. The admin sends
  // cover: "" (with no upload) when the editor removed the cover.
  const removed = !hasNewCover && input.cover === "";
  const cover = hasNewCover || (!removed && existing && existing.cover === coverPath) ? coverPath : "";

  return {
    slug: urlSlug,
    status: input.status,
    published,
    updated: new Date(nowMs).toISOString(),
    author,
    title,
    summary,
    body,
    cover,
    cover_alt,
  };
}

/** Summary row for the list view. */
export function summarize(post) {
  const lang = (o) => ({ en: typeof o?.en === "string" ? o.en : "", ar: typeof o?.ar === "string" ? o.ar : "" });
  return {
    slug: post.slug,
    status: post.status === "published" ? "published" : "draft",
    published: typeof post.published === "string" ? post.published : null,
    updated: typeof post.updated === "string" ? post.updated : "",
    title: lang(post.title),
    summary: lang(post.summary),
    cover: typeof post.cover === "string" ? post.cover : "",
  };
}

// ---------------------------------------------------------------- GitHub storage

const STORAGE_ERROR = "Could not reach the site storage. Try again in a minute.";

export function makeGitHub(gh, fetchImpl = fetch) {
  const base = `https://api.github.com/repos/${gh.repo}/contents/`;
  const encPath = (path) => path.split("/").map(encodeURIComponent).join("/");
  const headers = (accept = "application/vnd.github+json") => ({
    Authorization: `Bearer ${gh.token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "orvix-blog",
  });
  const committer = { name: "Orvix blog", email: gh.commitEmail };

  async function fail(res, what) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) {
      console.warn(`[blog] GitHub rejected the token (${res.status}) during ${what}: ${detail}`);
      throw new HttpError(502, STORAGE_ERROR);
    }
    if (res.status === 409 || res.status === 422) {
      console.warn(`[blog] GitHub conflict (${res.status}) during ${what}: ${detail}`);
      throw new HttpError(409, "Someone else changed this post at the same moment. Reload the page and try again.");
    }
    console.warn(`[blog] GitHub error ${res.status} during ${what}: ${detail}`);
    throw new HttpError(502, STORAGE_ERROR);
  }

  async function request(path, init, what) {
    try {
      return await fetchImpl(path, init);
    } catch (err) {
      console.warn(`[blog] GitHub network error during ${what}: ${err?.message || err}`);
      throw new HttpError(502, STORAGE_ERROR);
    }
  }

  const ref = `?ref=${encodeURIComponent(gh.branch)}`;

  return {
    /** Returns {sha, content: Buffer|null} or null if missing. */
    async getFile(path, { withContent = true } = {}) {
      const res = await request(base + encPath(path) + ref, { headers: headers() }, `read ${path}`);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, `read ${path}`);
      const meta = await res.json();
      if (Array.isArray(meta) || meta.type !== "file") return null;
      if (!withContent) return { sha: meta.sha, content: null };
      if (meta.encoding === "base64" && typeof meta.content === "string" && meta.content) {
        return { sha: meta.sha, content: Buffer.from(meta.content, "base64") };
      }
      // Files over 1 MB come back without content; fetch the raw bytes.
      const raw = await request(
        base + encPath(path) + ref,
        { headers: headers("application/vnd.github.raw+json") },
        `read raw ${path}`,
      );
      if (!raw.ok) await fail(raw, `read raw ${path}`);
      return { sha: meta.sha, content: Buffer.from(await raw.arrayBuffer()) };
    },

    /** Returns [{name, path, type}] or [] if the directory is missing. */
    async listDir(path) {
      const res = await request(base + encPath(path) + ref, { headers: headers() }, `list ${path}`);
      if (res.status === 404) return [];
      if (!res.ok) await fail(res, `list ${path}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },

    async putFile(path, contentBuf, message, sha) {
      const body = {
        message,
        content: contentBuf.toString("base64"),
        branch: gh.branch,
        committer,
        author: committer,
      };
      if (sha) body.sha = sha;
      const res = await request(
        base + encPath(path),
        { method: "PUT", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify(body) },
        `write ${path}`,
      );
      if (!res.ok) await fail(res, `write ${path}`);
    },

    async deleteFile(path, sha, message) {
      const res = await request(
        base + encPath(path),
        {
          method: "DELETE",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ message, sha, branch: gh.branch, committer, author: committer }),
        },
        `delete ${path}`,
      );
      if (res.status === 404) return;
      if (!res.ok) await fail(res, `delete ${path}`);
    },
  };
}

const postPath = (slug) => `content/posts/${slug}.json`;
const coverFile = (slug) => `images/posts/${slug}.webp`;

function parsePostFile(file, path) {
  try {
    const v = JSON.parse(file.content.toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v;
  } catch (err) {
    console.warn(`[blog] could not parse ${path}: ${err.message}`);
    return null;
  }
}

/** Run async fn over items with limited concurrency. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------- handlers

async function listPosts(store) {
  const entries = (await store.listDir("content/posts"))
    .filter((e) => e && e.type === "file" && typeof e.name === "string" && e.name.endsWith(".json"))
    .filter((e) => isValidSlug(e.name.slice(0, -5)))
    .slice(0, MAX_LIST_FILES);
  const posts = await mapLimit(entries, 8, async (e) => {
    const path = postPath(e.name.slice(0, -5));
    const file = await store.getFile(path);
    if (!file) return null;
    const post = parsePostFile(file, path);
    if (!post) return null;
    return summarize({ ...post, slug: e.name.slice(0, -5) });
  });
  return posts
    .filter(Boolean)
    .sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.slug.localeCompare(b.slug)));
}

async function getPost(store, slug) {
  const file = await store.getFile(postPath(slug));
  if (!file) return null;
  return parsePostFile(file, postPath(slug));
}

async function savePost(store, slug, payload, email, nowMs) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "No post was sent. Reload the page and try again.");
  }
  const upload = payload.cover_upload ?? null;
  const coverBuf = upload === null ? null : decodeCover(upload);

  const existingFile = await store.getFile(postPath(slug));
  const existing = existingFile ? parsePostFile(existingFile, postPath(slug)) : null;

  const saved = validatePost(slug, payload.post, existing, { hasNewCover: !!coverBuf, nowMs });

  let verb = "save draft";
  if (saved.status === "published") verb = "publish";
  else if (existing && existing.status === "published") verb = "unpublish";
  const message = `Blog: ${verb} ${slug} (${email})`;

  if (coverBuf) {
    const cur = await store.getFile(coverFile(slug), { withContent: false });
    await store.putFile(coverFile(slug), coverBuf, message, cur?.sha);
  }
  const content = Buffer.from(JSON.stringify(saved, null, 2) + "\n", "utf8");
  await store.putFile(postPath(slug), content, message, existingFile?.sha);
  const firstPublish = saved.status === "published" && (!existing || existing.status !== "published");
  return { saved, firstPublish };
}

async function deletePost(store, slug, email) {
  const message = `Blog: delete ${slug} (${email})`;
  const file = await store.getFile(postPath(slug), { withContent: false });
  const cover = await store.getFile(coverFile(slug), { withContent: false });
  if (!file && !cover) throw new HttpError(404, "Not found");
  if (cover) await store.deleteFile(coverFile(slug), cover.sha, message);
  if (file) await store.deleteFile(postPath(slug), file.sha, message);
}

// ---------------------------------------------------------------- login handlers

function clientIp(req, context) {
  return context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
}

async function handleLogin(req, context, cfg, { fetchImpl, nowMs, throttle }) {
  const body = await readJsonBody(req, MAX_LOGIN_BODY_BYTES);
  const raw = body && typeof body === "object" && typeof body.email === "string" ? body.email : "";
  const email = raw.trim().toLowerCase();
  const ok = json(200, { ok: true });
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return ok;

  // Count every request against both keys, allowed address or not.
  const ipOk = throttleHit(throttle, `ip:${clientIp(req, context)}`, nowMs);
  const emailOk = throttleHit(throttle, `email:${email}`, nowMs);
  if (!cfg.admins.includes(email)) {
    console.warn(`[blog] login requested for non-admin address`);
    return ok;
  }
  if (!ipOk || !emailOk) {
    console.warn(`[blog] login throttled for ${email} (${ipOk ? "email" : "ip"} limit)`);
    return ok;
  }
  const token = createLoginToken(email, cfg.secret, nowMs);
  const link = `${cfg.siteUrl}/api/login/verify?token=${encodeURIComponent(token)}`;
  const sending = sendLoginEmail(cfg, email, link, fetchImpl);
  // Where the runtime supports it, finish sending after responding so the
  // response time does not reveal whether the address is an editor.
  if (typeof context?.waitUntil === "function") context.waitUntil(sending);
  else await sending;
  return ok;
}

function handleVerify(req, cfg, nowMs) {
  const token = new URL(req.url).searchParams.get("token") || "";
  try {
    const claims = verifyToken(token, cfg.secret, "login", nowMs);
    if (!cfg.admins.includes(claims.email)) throw new Error(`email not in ADMIN_EMAILS: ${claims.email}`);
    const session = createSessionToken(claims.email, cfg.secret, nowMs);
    return redirect("/admin/", { "Set-Cookie": sessionCookie(session) });
  } catch (err) {
    console.warn(`[blog] sign-in link rejected: ${err?.message || err}`);
    return redirect("/admin/?signin=expired");
  }
}

// ---------------------------------------------------------------- newsletter subscribe (public)

const SUBSCRIBE_UNAVAILABLE = "Subscriptions are not available right now.";
const SUBSCRIBE_FAILED = "We could not add you right now. Please try again later.";

/** Newsletter config, independent of the admin config. Returns null when not configured. */
export function readSubscribeConfig(env) {
  const get = (k) => (typeof env[k] === "string" ? env[k].trim() : "");
  const apiKey = get("BREVO_API_KEY");
  const listRaw = get("BREVO_LIST_ID");
  const doiRaw = get("BREVO_DOI_TEMPLATE_ID");
  if (!apiKey || !/^[1-9]\d{0,9}$/.test(listRaw)) return null;
  let doiTemplateId = null;
  const siteUrl = get("SITE_URL").replace(/\/+$/, "");
  if (doiRaw) {
    if (!/^[1-9]\d{0,9}$/.test(doiRaw)) return null;
    doiTemplateId = Number(doiRaw);
    // Double opt-in needs SITE_URL for the confirmation redirect.
    try {
      const u = new URL(siteUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    } catch {
      return null;
    }
  }
  const listArRaw = get("BREVO_LIST_ID_AR");
  const listIdAr = /^[1-9]\d{0,9}$/.test(listArRaw) ? Number(listArRaw) : null;
  return { apiKey, listId: Number(listRaw), listIdAr, doiTemplateId, siteUrl };
}

async function handleSubscribe(req, context, env, { fetchImpl, nowMs, throttle }) {
  const sc = readSubscribeConfig(env);
  if (!sc) {
    console.warn("[blog] subscribe is not configured (BREVO_API_KEY / BREVO_LIST_ID)");
    return json(503, { error: SUBSCRIBE_UNAVAILABLE });
  }
  checkCsrf(req, "X-Orvix-Form");
  const body = await readJsonBody(req, MAX_SUBSCRIBE_BODY_BYTES);
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};

  // Honeypot: bots fill every field; people never see "company".
  if (typeof b.company === "string" ? b.company.trim() !== "" : b.company != null) {
    console.warn("[blog] subscribe honeypot triggered");
    return json(200, { ok: true });
  }

  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json(400, { error: "Please enter a valid email address." });
  }
  const lang = b.lang === "ar" ? "ar" : "en";
  const attributes = { LANGUAGE: lang };
  if (SECTORS.includes(b.sector)) attributes.SECTOR = b.sector;

  const ipOk = throttleHit(throttle, `sub-ip:${clientIp(req, context)}`, nowMs, 5);
  const emailOk = throttleHit(throttle, `sub-email:${email}`, nowMs, 3);
  if (!ipOk || !emailOk) {
    console.warn(`[blog] subscribe throttled (${ipOk ? "email" : "ip"} limit)`);
    return json(200, { ok: true });
  }

  const doi = sc.doiTemplateId !== null;
  const listId = lang === "ar" && sc.listIdAr ? sc.listIdAr : sc.listId;
  const url = doi ? "https://api.brevo.com/v3/contacts/doubleOptinConfirmation" : "https://api.brevo.com/v3/contacts";
  const payload = doi
    ? {
        email,
        includeListIds: [listId],
        templateId: sc.doiTemplateId,
        redirectionUrl: `${sc.siteUrl}${lang === "ar" ? "/ar" : ""}/research/subscribe/?confirmed=1`,
        attributes,
      }
    : { email, listIds: [listId], updateEnabled: true, attributes };

  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "api-key": sc.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "orvix-site/1.0",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn(`[blog] Brevo subscribe network error: ${err?.message || err}`);
    return json(502, { error: SUBSCRIBE_FAILED });
  }
  if (res.status === 201 || res.status === 204) return json(200, { ok: true, confirm: doi });
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  if (!doi && res.status === 400) {
    let code = "";
    try {
      code = JSON.parse(detail).code;
    } catch {
      /* ignore */
    }
    if (code === "duplicate_parameter") return json(200, { ok: true, confirm: false });
  }
  console.warn(`[blog] Brevo subscribe failed (${res.status}): ${detail}`);
  return json(502, { error: SUBSCRIBE_FAILED });
}

// ---------------------------------------------------------------- main handler

/**
 * Build a request handler. All dependencies are injectable for tests:
 *   env       environment object (default process.env)
 *   fetchImpl fetch used for GitHub and Brevo
 *   now       () => ms clock
 *   throttle  Map used by the login throttle (default: module-level)
 *   readFile  file reader for the newsletter templates (default fs.readFile)
 */
export function createHandler({ env = process.env, fetchImpl, now = Date.now, throttle = defaultThrottle, readFile } = {}) {
  return async function handler(req, context) {
    try {
      const doFetch = fetchImpl || globalThis.fetch;
      const nowMs = now();

      const route = parseRoute(new URL(req.url).pathname);
      if (!route) return json(404, { error: "Not found" });
      const allowed = ROUTE_METHODS[route.name];
      if (!allowed.includes(req.method)) {
        return json(405, { error: "Method not allowed" }, { Allow: allowed.join(", ") });
      }

      // Public newsletter form: its own config, no admin config, no session.
      if (route.name === "subscribe") {
        return await handleSubscribe(req, context, env, { fetchImpl: doFetch, nowMs, throttle });
      }

      const cfg = readConfig(env);
      if (!cfg) {
        console.warn("[blog] admin is not configured (missing or invalid env vars)");
        return json(503, { error: "Admin is not configured" });
      }

      // Public routes (no session needed).
      if (route.name === "login") {
        checkCsrf(req);
        return await handleLogin(req, context, cfg, { fetchImpl: doFetch, nowMs, throttle });
      }
      if (route.name === "verify") return handleVerify(req, cfg, nowMs);
      if (route.name === "logout") {
        checkCsrf(req);
        return json(200, { ok: true }, { "Set-Cookie": CLEAR_COOKIE });
      }

      // Everything below needs a valid session.
      const email = authenticate(req, cfg, nowMs);
      if (req.method === "PUT" || req.method === "DELETE") checkCsrf(req);

      if (route.name === "me") return json(200, { email });

      const store = makeGitHub(cfg.github, doFetch);
      if (route.name === "posts") return json(200, { posts: await listPosts(store) });

      // route.name === "post"
      const slug = route.slug;
      if (req.method === "PUT") {
        const payload = await readJsonBody(req);
        if (!isValidSlug(slug)) {
          throw new HttpError(
            400,
            "The web address (slug) may only use lowercase letters, numbers and single hyphens, up to 80 characters.",
          );
        }
        const { saved, firstPublish } = await savePost(store, slug, payload, email, nowMs);
        const out = { ok: true, post: saved, url: `/research/perspectives/${slug}/` };
        if (firstPublish) {
          // The post is already saved; newsletter drafts are a bonus and must
          // never turn a successful save into an error.
          try {
            out.newsletter = await createNewsletterDrafts({ post: saved, env, fetchImpl: doFetch, readFile, now });
          } catch (err) {
            out.newsletter = { created: [], skipped: [], errors: [{ lang: "all", message: "Newsletter drafts failed." }] };
            console.warn(`[blog] newsletter drafts failed: ${err?.message || err}`);
          }
          for (const e of out.newsletter.errors) console.warn(`[blog] newsletter draft (${e.lang}) failed: ${e.message}`);
        }
        return json(200, out);
      }
      if (!isValidSlug(slug)) return json(404, { error: "Not found" });
      if (req.method === "DELETE") {
        await deletePost(store, slug, email);
        return json(200, { ok: true });
      }
      const post = await getPost(store, slug);
      if (!post) return json(404, { error: "Not found" });
      return json(200, post);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.logReason) console.warn(`[blog] ${err.status}: ${err.logReason}`);
        return json(err.status, { error: err.message });
      }
      console.error("[blog] unexpected error", err);
      return json(500, { error: "Something went wrong. Try again in a minute." });
    }
  };
}

const defaultHandler = createHandler();

export default async (req, context) => defaultHandler(req, context);
