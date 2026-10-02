// Tests for blog.mjs. Run: node --test "netlify/functions/*.test.mjs"
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import {
  signToken,
  verifyToken,
  createLoginToken,
  createSessionToken,
  throttleHit,
  validatePost,
  isWebp,
  decodeCover,
  parseRoute,
  isValidSlug,
  readConfig,
  createHandler,
  HttpError,
} from "./blog.mjs";

// ---------------------------------------------------------------- fixtures

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const nowS = Math.floor(NOW / 1000);

const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

const ENV = {
  SESSION_SECRET: SECRET,
  ADMIN_EMAILS: " editor@orvixnet.com , Owner@Gmail.com",
  SITE_URL: "https://orvixnet.com/",
  BREVO_API_KEY: "xkeysib-test",
  MAIL_FROM_EMAIL: "no-reply@orvixnet.com",
  GITHUB_TOKEN: "ghp_test",
  GITHUB_REPO: "TheSamuraiCorproation/Orvix-Website",
};

const session = (email = "editor@orvixnet.com", nowMs = NOW) => createSessionToken(email, SECRET, nowMs);

const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(24),
]);

function goodPost(over = {}) {
  return {
    slug: "my-first-post",
    status: "draft",
    author: "  Sarah  ",
    title: { en: " Hello ", ar: "مرحبا" },
    summary: { en: "Short summary", ar: "" },
    body: { en: "# Body\n\ntext", ar: "" },
    cover_alt: { en: "A picture" },
    ...over,
  };
}

/** Build a request; sends a valid session cookie unless token is null. */
function req(path, { method = "GET", token = session(), headers = {}, body } = {}) {
  const h = { ...headers };
  if (token) h.cookie = `other=1; __Host-orvix_admin=${token}`;
  return new Request(`https://orvixnet.com${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const writeHeaders = { "x-orvix-admin": "1", "content-type": "application/json" };

/** Minimal in-memory GitHub Contents API. */
function fakeGitHub(files = {}) {
  const store = new Map(Object.entries(files).map(([p, c]) => [p, { content: Buffer.from(c), sha: "sha-" + p }]));
  const calls = [];
  const prefix = "https://api.github.com/repos/TheSamuraiCorproation/Orvix-Website/contents/";
  async function fetchImpl(url, init = {}) {
    const method = init.method || "GET";
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(new URL(prefix).pathname, ""));
    calls.push({ method, path, url, init, body: init.body ? JSON.parse(init.body) : null });
    assert.equal(init.headers.Authorization, "Bearer ghp_test");
    assert.equal(init.headers["User-Agent"], "orvix-blog");
    const j = (status, obj) => new Response(JSON.stringify(obj), { status });
    if (method === "GET") {
      if (store.has(path)) {
        const f = store.get(path);
        return j(200, { type: "file", sha: f.sha, encoding: "base64", content: f.content.toString("base64") });
      }
      const kids = [...store.keys()].filter((k) => k.startsWith(path + "/"));
      if (kids.length) {
        return j(200, kids.map((k) => ({ type: "file", name: k.slice(path.length + 1), path: k })));
      }
      return j(404, { message: "Not Found" });
    }
    if (method === "PUT") {
      const b = JSON.parse(init.body);
      const cur = store.get(path);
      if (cur && b.sha !== cur.sha) return j(409, { message: "sha mismatch" });
      store.set(path, { content: Buffer.from(b.content, "base64"), sha: "sha2-" + path });
      return j(200, {});
    }
    if (method === "DELETE") {
      store.delete(path);
      return j(200, {});
    }
    return j(405, {});
  }
  return { fetchImpl, store, calls };
}

/** Fake Brevo endpoint recording sent emails. */
function fakeBrevo({ status = 201 } = {}) {
  const sent = [];
  async function fetchImpl(url, init = {}) {
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["api-key"], "xkeysib-test");
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: "x" }), { status });
  }
  return { fetchImpl, sent };
}

const linkToken = (mail) => new URL(/https:\/\/\S+/.exec(mail.textContent)[0]).searchParams.get("token");

// ---------------------------------------------------------------- tokens

describe("signed tokens", () => {
  test("login token signs and verifies", () => {
    const t = createLoginToken("editor@orvixnet.com", SECRET, NOW);
    const c = verifyToken(t, SECRET, "login", NOW + 60_000);
    assert.equal(c.email, "editor@orvixnet.com");
    assert.equal(c.typ, "login");
    assert.equal(c.exp - c.iat, 15 * 60);
    assert.equal(Buffer.from(c.nonce, "base64url").length, 16);
    assert.deepEqual(JSON.parse(Buffer.from(t.split(".")[0], "base64url")), { alg: "HS256", typ: "JWT" });
  });

  test("session token lasts 8 hours", () => {
    const c = verifyToken(session(), SECRET, "session", NOW);
    assert.equal(c.exp - c.iat, 8 * 3600);
    assert.throws(() => verifyToken(session(), SECRET, "session", NOW + 8 * 3600 * 1000), /expired/);
  });

  test("tampered payload or signature, or another secret, is rejected", () => {
    const t = createLoginToken("editor@orvixnet.com", SECRET, NOW);
    const [h, , s] = t.split(".");
    const forged = `${h}.${b64u({ typ: "login", email: "evil@x.com", iat: nowS, exp: nowS + 900 })}.${s}`;
    assert.throws(() => verifyToken(forged, SECRET, "login", NOW), /bad signature/);
    const flipped = t.slice(0, -2) + (t.at(-2) === "A" ? "B" : "A") + t.at(-1);
    assert.throws(() => verifyToken(flipped, SECRET, "login", NOW), /bad signature|malformed/);
    assert.throws(() => verifyToken(t, SECRET + "x", "login", NOW), /bad signature/);
  });

  test("alg other than HS256 is rejected (none, RS256)", () => {
    const p = b64u({ typ: "session", email: "editor@orvixnet.com", iat: nowS, exp: nowS + 900 });
    for (const alg of ["none", "RS256", "HS512"]) {
      const h = b64u({ alg, typ: "JWT" });
      const s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
      assert.throws(() => verifyToken(`${h}.${p}.${s}`, SECRET, "session", NOW), /alg not allowed/);
    }
    assert.throws(() => verifyToken(`${b64u({ alg: "none" })}.${p}.`, SECRET, "session", NOW), /malformed/);
  });

  test("expired login token is rejected", () => {
    const t = createLoginToken("editor@orvixnet.com", SECRET, NOW);
    assert.throws(() => verifyToken(t, SECRET, "login", NOW + 15 * 60 * 1000 + 1), /expired/);
  });

  test("login token is not a session token and vice versa", () => {
    const login = createLoginToken("editor@orvixnet.com", SECRET, NOW);
    assert.throws(() => verifyToken(login, SECRET, "session", NOW), /wrong token type/);
    assert.throws(() => verifyToken(session(), SECRET, "login", NOW), /wrong token type/);
  });

  test("garbage is rejected", () => {
    for (const t of ["", "a.b", "a.b.c", "a.b.c.d", null]) assert.throws(() => verifyToken(t, SECRET, "login", NOW));
    const noEmail = signToken({ typ: "login", iat: nowS, exp: nowS + 60 }, SECRET);
    assert.throws(() => verifyToken(noEmail, SECRET, "login", NOW), /email/);
  });

  test("throttle allows 5 per 15 minutes per key", () => {
    const m = new Map();
    for (let i = 0; i < 5; i++) assert.ok(throttleHit(m, "k", NOW + i));
    assert.ok(!throttleHit(m, "k", NOW + 10));
    assert.ok(throttleHit(m, "other", NOW + 10));
    assert.ok(throttleHit(m, "k", NOW + 16 * 60 * 1000));
  });
});

// ---------------------------------------------------------------- handler: login flow

describe("login flow", () => {
  const loginReq = (email, headers = {}) =>
    req("/api/login", { method: "POST", token: null, headers: { ...writeHeaders, ...headers }, body: { email } });

  test("non-allowlisted email: 200 ok, Brevo not called", async () => {
    const brevo = fakeBrevo();
    const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: brevo.fetchImpl, throttle: new Map() });
    const res = await handler(loginReq("stranger@gmail.com"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(brevo.sent.length, 0);
    const bad = await handler(loginReq("not an email"));
    assert.deepEqual(await bad.json(), { ok: true });
    assert.equal(brevo.sent.length, 0);
  });

  test("allowlisted email: Brevo called once with the right link", async () => {
    const brevo = fakeBrevo();
    const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: brevo.fetchImpl, throttle: new Map() });
    const res = await handler(loginReq("  OWNER@gmail.com "));
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(brevo.sent.length, 1);
    const mail = brevo.sent[0];
    assert.deepEqual(mail.to, [{ email: "owner@gmail.com" }]);
    assert.deepEqual(mail.sender, { email: "no-reply@orvixnet.com", name: "Orvix" });
    assert.equal(mail.subject, "Your Orvix admin sign-in link");
    assert.match(mail.textContent, /^Sign in to the Orvix Perspectives admin: https:\/\/orvixnet\.com\/api\/login\/verify\?token=/);
    assert.match(mail.textContent, /This link works for 15 minutes\. If you didn't ask for it, ignore this email\./);
    assert.match(mail.htmlContent, /href="https:\/\/orvixnet\.com\/api\/login\/verify\?token=/);
    const c = verifyToken(linkToken(mail), SECRET, "login", NOW);
    assert.equal(c.email, "owner@gmail.com");
  });

  test("Brevo failure still returns 200", async () => {
    const brevo = fakeBrevo({ status: 500 });
    const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: brevo.fetchImpl, throttle: new Map() });
    assert.deepEqual(await (await handler(loginReq("editor@orvixnet.com"))).json(), { ok: true });
    const boom = createHandler({ env: ENV, now: () => NOW, fetchImpl: async () => { throw new Error("down"); }, throttle: new Map() });
    assert.equal((await boom(loginReq("editor@orvixnet.com"))).status, 200);
  });

  test("throttle: 3 sends per email, 5 per IP, per 15 minutes", async () => {
    const brevo = fakeBrevo();
    const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: brevo.fetchImpl, throttle: new Map() });
    for (let i = 0; i < 6; i++) {
      const res = await handler(loginReq("editor@orvixnet.com", { "x-nf-client-connection-ip": `10.0.0.${i}` }));
      assert.equal(res.status, 200);
    }
    assert.equal(brevo.sent.length, 3); // the email key stops the 4th, even from fresh IPs

    const brevo2 = fakeBrevo();
    const h2 = createHandler({ env: ENV, now: () => NOW, fetchImpl: brevo2.fetchImpl, throttle: new Map() });
    for (let i = 0; i < 5; i++) await h2(loginReq(`stranger${i}@x.com`), { ip: "1.2.3.4" });
    await h2(loginReq("editor@orvixnet.com"), { ip: "1.2.3.4" });
    assert.equal(brevo2.sent.length, 0);
  });

  test("login needs the CSRF header", async () => {
    const brevo = fakeBrevo();
    const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: brevo.fetchImpl, throttle: new Map() });
    const res = await handler(
      req("/api/login", { method: "POST", token: null, headers: { "content-type": "application/json" }, body: { email: "editor@orvixnet.com" } }),
    );
    assert.equal(res.status, 403);
    assert.equal((await handler(loginReq("editor@orvixnet.com", { origin: "https://evil.example" }))).status, 403);
    assert.equal(brevo.sent.length, 0);
  });

  test("verify sets the session cookie and redirects to /admin/", async () => {
    const handler = createHandler({ env: ENV, now: () => NOW + 60_000 });
    const t = createLoginToken("editor@orvixnet.com", SECRET, NOW, "bind-abc");
    const res = await handler(req(`/api/login/verify?token=${encodeURIComponent(t)}`, { token: null, headers: { cookie: "__Host-orvix_login=bind-abc" } }));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/admin/");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const cookies = res.headers.getSetCookie();
    const m = /^__Host-orvix_admin=([^;]+); Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/.exec(cookies[0]);
    assert.ok(m, cookies[0]);
    assert.match(cookies[1], /^__Host-orvix_login=; .*Max-Age=0$/); // the binding cookie is cleared
    assert.equal(verifyToken(m[1], SECRET, "session", NOW + 60_000).email, "editor@orvixnet.com");
    // The new cookie works on /api/me.
    const me = await handler(req("/api/me", { token: m[1] }));
    assert.deepEqual(await me.json(), { email: "editor@orvixnet.com" });
  });

  test("bad, expired or session-typed token -> 302 /admin/?signin=expired, no cookie", async () => {
    const handler = createHandler({ env: ENV, now: () => NOW });
    const expired = createLoginToken("editor@orvixnet.com", SECRET, NOW - 16 * 60 * 1000);
    for (const t of ["", "garbage", expired, session()]) {
      const res = await handler(req(`/api/login/verify?token=${encodeURIComponent(t)}`, { token: null }));
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/admin/?signin=expired");
      assert.equal(res.headers.get("set-cookie"), null);
    }
  });

  test("a link opened in another browser (no binding cookie) -> /admin/?signin=browser, no session", async () => {
    const handler = createHandler({ env: ENV, now: () => NOW });
    const t = createLoginToken("editor@orvixnet.com", SECRET, NOW, "bind-abc");
    for (const cookie of [undefined, "__Host-orvix_login=other", "__Host-orvix_login="]) {
      const res = await handler(req(`/api/login/verify?token=${encodeURIComponent(t)}`, { token: null, headers: cookie ? { cookie } : {} }));
      assert.equal(res.headers.get("location"), "/admin/?signin=browser");
      assert.equal(res.headers.get("set-cookie"), null);
    }
  });

  test("login sets the binding cookie, for any address", async () => {
    const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: fakeBrevo().fetchImpl, throttle: new Map() });
    for (const email of ["editor@orvixnet.com", "stranger@gmail.com"]) {
      const res = await handler(loginReq(email));
      assert.match(res.headers.get("set-cookie") || "", /^__Host-orvix_login=[A-Za-z0-9_-]{16,}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=900$/);
    }
  });

  test("email removed from the allowlist after the link was sent -> verify fails", async () => {
    const t = createLoginToken("owner@gmail.com", SECRET, NOW);
    const handler = createHandler({ env: { ...ENV, ADMIN_EMAILS: "editor@orvixnet.com" }, now: () => NOW });
    const res = await handler(req(`/api/login/verify?token=${t}`, { token: null }));
    assert.equal(res.headers.get("location"), "/admin/?signin=expired");
    assert.equal(res.headers.get("set-cookie"), null);
    // And an existing session for that address stops working too.
    assert.equal((await handler(req("/api/me", { token: session("owner@gmail.com") }))).status, 401);
  });

  test("logout clears the cookie (and needs the CSRF header)", async () => {
    const handler = createHandler({ env: ENV, now: () => NOW });
    const res = await handler(req("/api/logout", { method: "POST", headers: writeHeaders }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(
      res.headers.get("set-cookie"),
      "__Host-orvix_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    );
    assert.equal((await handler(req("/api/logout", { method: "POST" }))).status, 403);
  });
});

// ---------------------------------------------------------------- handler: auth, config, CSRF

describe("handler auth", () => {
  const gh = fakeGitHub();
  const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: gh.fetchImpl });

  test("GET /api/me returns the email with security headers", async () => {
    const res = await handler(req("/api/me"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { email: "editor@orvixnet.com" });
    assert.match(res.headers.get("content-type"), /^application\/json/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  test("works through the /.netlify/functions/blog path", async () => {
    assert.equal((await handler(req("/.netlify/functions/blog/me"))).status, 200);
  });

  test("posts routes: 401 without cookie, 200 with", async () => {
    for (const p of ["/api/me", "/api/posts", "/api/posts/abc"]) {
      const res = await handler(req(p, { token: null }));
      assert.equal(res.status, 401, p);
      assert.deepEqual(await res.json(), { error: "Not signed in" });
    }
    assert.equal((await handler(req("/api/posts/abc", { method: "PUT", token: null, headers: writeHeaders, body: {} }))).status, 401);
    const ok = await handler(req("/api/posts"));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { posts: [] });
  });

  test("login token, expired, forged or non-admin session cookie -> 401", async () => {
    const bad = [
      createLoginToken("editor@orvixnet.com", SECRET, NOW),
      session("editor@orvixnet.com", NOW - 9 * 3600 * 1000),
      createSessionToken("editor@orvixnet.com", "another-secret-another-secret-xx", NOW),
      session("stranger@gmail.com"),
    ];
    for (const t of bad) assert.equal((await handler(req("/api/me", { token: t }))).status, 401);
  });

  test("missing env -> 503", async () => {
    for (const k of Object.keys(ENV)) {
      const h = createHandler({ env: { ...ENV, [k]: "" }, now: () => NOW });
      const res = await h(req("/api/me"));
      assert.equal(res.status, 503, k);
      assert.deepEqual(await res.json(), { error: "Admin is not configured" });
    }
    for (const over of [{ ADMIN_EMAILS: " , " }, { SESSION_SECRET: "too-short" }, { SITE_URL: "orvixnet.com" }]) {
      const h = createHandler({ env: { ...ENV, ...over }, now: () => NOW });
      assert.equal((await h(req("/api/login", { method: "POST", headers: writeHeaders, body: {} }))).status, 503);
    }
  });

  test("CSRF: PUT/DELETE without X-Orvix-Admin -> 403", async () => {
    let res = await handler(
      req("/api/posts/abc", { method: "PUT", headers: { "content-type": "application/json" }, body: {} }),
    );
    assert.equal(res.status, 403);
    res = await handler(req("/api/posts/abc", { method: "DELETE", headers: { "content-type": "application/json" } }));
    assert.equal(res.status, 403);
  });

  test("CSRF: wrong content-type or foreign Origin -> 403", async () => {
    let res = await handler(
      req("/api/posts/abc", { method: "PUT", headers: { "x-orvix-admin": "1", "content-type": "text/plain" }, body: "{}" }),
    );
    assert.equal(res.status, 403);
    res = await handler(
      req("/api/posts/abc", { method: "PUT", headers: { ...writeHeaders, origin: "https://evil.example" }, body: {} }),
    );
    assert.equal(res.status, 403);
  });

  test("wrong method -> 405, unknown route -> 404", async () => {
    assert.equal((await handler(req("/api/me", { method: "POST" }))).status, 405);
    assert.equal((await handler(req("/api/posts", { method: "DELETE" }))).status, 405);
    assert.equal((await handler(req("/api/login", { method: "GET" }))).status, 405);
    assert.equal((await handler(req("/api/nope"))).status, 404);
  });

  test("body over 6 MB -> 413", async () => {
    const res = await handler(
      req("/api/posts/abc", { method: "PUT", headers: writeHeaders, body: "x".repeat(6 * 1024 * 1024 + 1) }),
    );
    assert.equal(res.status, 413);
  });
});

// ---------------------------------------------------------------- pure helpers

describe("routing and slugs", () => {
  test("parseRoute", () => {
    assert.deepEqual(parseRoute("/api/me"), { name: "me" });
    assert.deepEqual(parseRoute("/api/login"), { name: "login" });
    assert.deepEqual(parseRoute("/api/login/verify"), { name: "verify" });
    assert.deepEqual(parseRoute("/api/logout"), { name: "logout" });
    assert.deepEqual(parseRoute("/api/posts/"), { name: "posts" });
    assert.deepEqual(parseRoute("/.netlify/functions/blog/posts/a-b"), { name: "post", slug: "a-b" });
    assert.deepEqual(parseRoute("/posts/x"), { name: "post", slug: "x" });
    assert.equal(parseRoute("/api/posts/a/b"), null);
    assert.equal(parseRoute("/apiposts"), null);
  });

  test("isValidSlug", () => {
    for (const ok of ["a", "abc-123", "x".repeat(80)]) assert.ok(isValidSlug(ok), ok);
    for (const bad of ["", "A", "a--b", "-a", "a-", "a_b", "a b", "../x", "x".repeat(81), "é"]) {
      assert.ok(!isValidSlug(bad), bad);
    }
  });

  test("readConfig trims and lowercases", () => {
    const c = readConfig(ENV);
    assert.equal(c.siteUrl, "https://orvixnet.com");
    assert.deepEqual(c.admins, ["editor@orvixnet.com", "owner@gmail.com"]);
    assert.equal(c.mail.fromName, "Orvix");
    assert.equal(c.github.branch, "main");
    assert.equal(c.github.commitEmail, "blog@orvixnet.com");
  });
});


describe("validatePost", () => {
  const opts = { nowMs: NOW };

  test("slug must be valid and match post.slug", () => {
    assert.throws(() => validatePost("Bad Slug", goodPost(), null, opts), HttpError);
    assert.throws(() => validatePost("other-slug", goodPost(), null, opts), /does not match/);
  });

  test("draft is stored with trimmed strings and null published date", () => {
    const p = validatePost("my-first-post", goodPost(), null, opts);
    assert.equal(p.author, "Sarah");
    assert.deepEqual(p.title, { en: "Hello", ar: "مرحبا" });
    assert.deepEqual(p.cover_alt, { en: "A picture", ar: "" });
    assert.equal(p.published, null);
    assert.equal(p.updated, "2026-10-01T12:00:00.000Z");
  });

  test("extra fields are ignored, client cover path is ignored", () => {
    const p = validatePost(
      "my-first-post",
      goodPost({ evil: "<script>", cover: "https://evil/x.png", published: "1999-01-01", title: { en: "T", xx: 1 } }),
      null,
      opts,
    );
    assert.deepEqual(Object.keys(p).sort(), [
      "author", "body", "cover", "cover_alt", "published", "slug", "status", "summary", "title", "updated",
    ]);
    assert.deepEqual(Object.keys(p.title), ["en", "ar"]);
    assert.equal(p.cover, "");
    assert.equal(p.published, null);
  });

  test("status must be draft or published", () => {
    assert.throws(() => validatePost("my-first-post", goodPost({ status: "live" }), null, opts), /status/);
  });

  test("length limits", () => {
    assert.throws(() => validatePost("my-first-post", goodPost({ title: { en: "x".repeat(121) } }), null, opts), /too long/);
    assert.throws(() => validatePost("my-first-post", goodPost({ summary: { ar: "x".repeat(301) } }), null, opts), /too long/);
    assert.throws(() => validatePost("my-first-post", goodPost({ body: { en: "x".repeat(50001) } }), null, opts), /too long/);
    assert.throws(() => validatePost("my-first-post", goodPost({ author: "x".repeat(81) }), null, opts), /too long/);
    assert.throws(() => validatePost("my-first-post", goodPost({ title: { en: 5 } }), null, opts), /must be text/);
  });

  test("publishing requires English title, summary and body", () => {
    assert.throws(
      () => validatePost("my-first-post", goodPost({ status: "published", title: { ar: "x" }, body: { en: "  " } }), null, opts),
      /English title, English article text/,
    );
    assert.throws(
      () => validatePost("my-first-post", goodPost({ status: "published", summary: {} }), null, opts),
      /English summary/,
    );
  });

  test("published date: set on first publish, kept afterwards", () => {
    const first = validatePost("my-first-post", goodPost({ status: "published" }), null, opts);
    assert.equal(first.published, "2026-10-01");
    const later = validatePost("my-first-post", goodPost({ status: "published" }), { published: "2025-03-04" }, opts);
    assert.equal(later.published, "2025-03-04");
    const unpublished = validatePost("my-first-post", goodPost({ status: "draft" }), { published: "2025-03-04" }, opts);
    assert.equal(unpublished.published, "2025-03-04");
  });

  test("cover kept from stored post or set by upload", () => {
    const c = "/images/posts/my-first-post.webp";
    assert.equal(validatePost("my-first-post", goodPost(), { cover: c }, opts).cover, c);
    assert.equal(validatePost("my-first-post", goodPost(), { cover: "/x.png" }, opts).cover, "");
    assert.equal(validatePost("my-first-post", goodPost(), null, { ...opts, hasNewCover: true }).cover, c);
  });
});

describe("webp", () => {
  test("isWebp checks RIFF....WEBP", () => {
    assert.ok(isWebp(WEBP));
    assert.ok(!isWebp(Buffer.from("RIFF\0\0\0\0WAVEfmt ")));
    assert.ok(!isWebp(Buffer.from("\x89PNG\r\n\x1a\n0000")));
    assert.ok(!isWebp(Buffer.from("RIFF")));
  });

  test("decodeCover validates type, size and magic bytes", () => {
    assert.equal(decodeCover({ type: "image/webp", data: WEBP.toString("base64") }).length, WEBP.length);
    assert.throws(() => decodeCover({ type: "image/png", data: WEBP.toString("base64") }), /WebP/);
    assert.throws(() => decodeCover({ type: "image/webp", data: Buffer.from("GIF89a000000").toString("base64") }), /real WebP/);
    assert.throws(() => decodeCover({ type: "image/webp", data: "!!!" }), /not valid/);
    const big = Buffer.concat([WEBP, Buffer.alloc(3 * 1024 * 1024)]);
    assert.throws(() => decodeCover({ type: "image/webp", data: big.toString("base64") }), /too large/);
  });
});

// ---------------------------------------------------------------- handler + mocked GitHub

describe("handler with mocked GitHub", () => {
  test("PUT saves a published post with a cover, commits with the right message", async () => {
    const gh = fakeGitHub();
    const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: gh.fetchImpl });
    const res = await handler(
      req("/api/posts/my-first-post", {
        method: "PUT",
        headers: { ...writeHeaders, origin: "https://orvixnet.com" },
        body: {
          post: goodPost({ status: "published", extra: 1 }),
          cover_upload: { type: "image/webp", data: WEBP.toString("base64") },
        },
      }),
    );
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.equal(out.ok, true);
    assert.equal(out.url, "/research/perspectives/my-first-post/");
    assert.equal(out.post.published, "2026-10-01");
    assert.equal(out.post.cover, "/images/posts/my-first-post.webp");
    assert.equal(out.post.extra, undefined);

    const puts = gh.calls.filter((c) => c.method === "PUT");
    assert.deepEqual(puts.map((c) => c.path), ["images/posts/my-first-post.webp", "content/posts/my-first-post.json"]);
    for (const p of puts) {
      assert.equal(p.body.message, "Blog: publish my-first-post (editor@orvixnet.com)");
      assert.equal(p.body.branch, "main");
      assert.deepEqual(p.body.committer, { name: "Orvix blog", email: "blog@orvixnet.com" });
      assert.equal(p.body.sha, undefined); // new files
    }
    const stored = gh.store.get("content/posts/my-first-post.json").content.toString("utf8");
    assert.ok(stored.endsWith("}\n"));
    assert.ok(stored.includes('\n  "slug": "my-first-post"'));
    assert.deepEqual(JSON.parse(stored), out.post);

    // Save again as draft: sha passed, date kept, "unpublish" message, cover kept.
    const res2 = await handler(
      req("/api/posts/my-first-post", { method: "PUT", headers: writeHeaders, body: { post: goodPost(), cover_upload: null } }),
    );
    const out2 = await res2.json();
    assert.equal(res2.status, 200, JSON.stringify(out2));
    assert.equal(out2.post.published, "2026-10-01");
    assert.equal(out2.post.cover, "/images/posts/my-first-post.webp");
    const last = gh.calls.filter((c) => c.method === "PUT").at(-1);
    assert.equal(last.body.sha, "sha2-content/posts/my-first-post.json");
    assert.equal(last.body.message, "Blog: unpublish my-first-post (editor@orvixnet.com)");
  });

  test("PUT validation failure -> 400 with a readable message and no commit", async () => {
    const gh = fakeGitHub();
    const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: gh.fetchImpl });
    const res = await handler(
      req("/api/posts/my-first-post", {
        method: "PUT",
        headers: writeHeaders,
        body: { post: goodPost({ status: "published", title: {} }), cover_upload: null },
      }),
    );
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /To publish, please fill in: English title/);
    assert.equal(gh.calls.filter((c) => c.method === "PUT").length, 0);
  });

  test("GET /api/posts lists summaries newest first; GET one; DELETE", async () => {
    const mk = (slug, updated, status = "draft") =>
      JSON.stringify({ slug, status, published: null, updated, title: { en: slug, ar: "" }, summary: { en: "s", ar: "" }, body: { en: "big", ar: "" }, cover: "" });
    const gh = fakeGitHub({
      "content/posts/old.json": mk("old", "2026-01-01T00:00:00.000Z"),
      "content/posts/new.json": mk("new", "2026-09-01T00:00:00.000Z", "published"),
      "content/posts/broken.json": "{not json",
      "content/posts/README.md": "ignore me",
      "images/posts/new.webp": "RIFF0000WEBP",
    });
    const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: gh.fetchImpl });

    const list = await (await handler(req("/api/posts"))).json();
    assert.deepEqual(list.posts.map((p) => p.slug), ["new", "old"]);
    assert.deepEqual(Object.keys(list.posts[0]).sort(), ["cover", "published", "slug", "status", "summary", "title", "updated"]);

    const one = await handler(req("/api/posts/new"));
    assert.equal(one.status, 200);
    assert.equal((await one.json()).body.en, "big");
    assert.equal((await handler(req("/api/posts/missing"))).status, 404);
    assert.equal((await handler(req("/api/posts/..%2Fsecret"))).status, 404);

    const del = await handler(req("/api/posts/new", { method: "DELETE", headers: writeHeaders }));
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { ok: true });
    assert.ok(!gh.store.has("content/posts/new.json"));
    assert.ok(!gh.store.has("images/posts/new.webp"));
    const dels = gh.calls.filter((c) => c.method === "DELETE");
    assert.equal(dels.length, 2);
    assert.equal(dels[0].body.message, "Blog: delete new (editor@orvixnet.com)");
  });

  test("empty repo lists no posts", async () => {
    const gh = fakeGitHub();
    const handler = createHandler({ env: ENV, now: () => NOW, fetchImpl: gh.fetchImpl });
    assert.deepEqual(await (await handler(req("/api/posts"))).json(), { posts: [] });
  });
});

// ---------------------------------------------------------------- public newsletter subscribe

describe("POST /api/subscribe", () => {
  // Only the newsletter env: admin variables deliberately absent.
  const SUB_ENV = { BREVO_API_KEY: "xkeysib-test", BREVO_LIST_ID: "7" };
  const DOI_ENV = { ...SUB_ENV, BREVO_DOI_TEMPLATE_ID: "12", SITE_URL: "https://orvixnet.com/" };
  const formHeaders = { "x-orvix-form": "1", "content-type": "application/json", origin: "https://orvixnet.com" };

  function fakeContacts(respond = () => new Response(null, { status: 201 })) {
    const calls = [];
    async function fetchImpl(url, init = {}) {
      assert.equal(init.method, "POST");
      assert.equal(init.headers["api-key"], "xkeysib-test");
      assert.equal(init.headers["Content-Type"], "application/json");
      assert.equal(init.headers.Accept, "application/json");
      calls.push({ url, body: JSON.parse(init.body) });
      return respond(url);
    }
    return { fetchImpl, calls };
  }

  const subReq = (body, { headers = formHeaders, ip = "9.9.9.9" } = {}) =>
    req("/api/subscribe", { method: "POST", token: null, headers: { ...headers, "x-nf-client-connection-ip": ip }, body });

  const make = (env, fake) => createHandler({ env, now: () => NOW, fetchImpl: fake.fetchImpl, throttle: new Map() });

  test("missing list env -> 503, even with the admin env absent", async () => {
    for (const env of [{}, { BREVO_API_KEY: "xkeysib-test" }, { BREVO_LIST_ID: "7" }, { ...SUB_ENV, BREVO_LIST_ID: "abc" }]) {
      const fake = fakeContacts();
      const res = await make(env, fake)(subReq({ email: "a@b.co" }));
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "Subscriptions are not available right now." });
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(fake.calls.length, 0);
    }
  });

  test("works without any admin env; admin routes still 503", async () => {
    const fake = fakeContacts();
    const h = make(SUB_ENV, fake);
    const res = await h(subReq({ email: "a@b.co", lang: "en", company: "" }));
    assert.equal(res.status, 200);
    assert.equal((await h(req("/api/me"))).status, 503);
  });

  test("missing X-Orvix-Form header, wrong content-type or foreign Origin -> 403", async () => {
    const fake = fakeContacts();
    const h = make(SUB_ENV, fake);
    assert.equal((await h(subReq({ email: "a@b.co" }, { headers: { "content-type": "application/json" } }))).status, 403);
    assert.equal((await h(subReq({ email: "a@b.co" }, { headers: { ...formHeaders, "content-type": "text/plain" } }))).status, 403);
    assert.equal((await h(subReq({ email: "a@b.co" }, { headers: { ...formHeaders, origin: "https://evil.example" } }))).status, 403);
    // The admin header is not a substitute.
    assert.equal((await h(subReq({ email: "a@b.co" }, { headers: writeHeaders }))).status, 403);
    assert.equal(fake.calls.length, 0);
    assert.equal((await h(req("/api/subscribe", { token: null }))).status, 405);
  });

  test("body over 10 KB -> 413", async () => {
    const fake = fakeContacts();
    const res = await make(SUB_ENV, fake)(subReq({ email: "a@b.co", pad: "x".repeat(11 * 1024) }));
    assert.equal(res.status, 413);
    assert.equal(fake.calls.length, 0);
  });

  test("honeypot filled -> 200 without calling Brevo", async () => {
    const fake = fakeContacts();
    const res = await make(SUB_ENV, fake)(subReq({ email: "a@b.co", company: "Spam Inc" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(fake.calls.length, 0);
  });

  test("bad email -> 400 without echoing it", async () => {
    const fake = fakeContacts();
    const h = make(SUB_ENV, fake);
    for (const email of ["", "nope", "a@b", "<script>@x.com", `${"a".repeat(250)}@b.co`, 42]) {
      const res = await h(subReq({ email }));
      assert.equal(res.status, 400, String(email));
      assert.deepEqual(await res.json(), { error: "Please enter a valid email address." });
    }
    assert.equal(fake.calls.length, 0);
  });

  test("single opt-in: POST /v3/contacts with listIds and updateEnabled", async () => {
    const fake = fakeContacts();
    const res = await make(SUB_ENV, fake)(subReq({ email: "  Reader@Example.COM ", lang: "ar", company: "" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, confirm: false });
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].url, "https://api.brevo.com/v3/contacts");
    assert.deepEqual(fake.calls[0].body, {
      email: "reader@example.com",
      listIds: [7],
      updateEnabled: true,
      attributes: { LANGUAGE: "ar" },
    });
  });

  test("sector from the page's list goes to SECTOR; anything else is dropped", async () => {
    const fake = fakeContacts();
    await make(SUB_ENV, fake)(subReq({ email: "a@b.co", sector: "Energy & utilities" }));
    await make(SUB_ENV, fake)(subReq({ email: "c@d.co", sector: "<script>" }));
    assert.deepEqual(fake.calls[0].body.attributes, { LANGUAGE: "en", SECTOR: "Energy & utilities" });
    assert.deepEqual(fake.calls[1].body.attributes, { LANGUAGE: "en" });
  });

  test("duplicate_parameter counts as ok; other 400s do not", async () => {
    const dup = fakeContacts(() => new Response(JSON.stringify({ code: "duplicate_parameter", message: "Contact already exist" }), { status: 400 }));
    const res = await make(SUB_ENV, dup)(subReq({ email: "a@b.co" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, confirm: false });

    const other = fakeContacts(() => new Response(JSON.stringify({ code: "invalid_parameter" }), { status: 400 }));
    assert.equal((await make(SUB_ENV, other)(subReq({ email: "a@b.co" }))).status, 502);
  });

  test("double opt-in: doubleOptinConfirmation with templateId, includeListIds and the right redirect (EN and AR)", async () => {
    const fake = fakeContacts(() => new Response(null, { status: 204 }));
    const h = make(DOI_ENV, fake);
    let res = await h(subReq({ email: "en@example.com", lang: "en" }));
    assert.deepEqual(await res.json(), { ok: true, confirm: true });
    res = await h(subReq({ email: "ar@example.com", lang: "ar" }));
    assert.deepEqual(await res.json(), { ok: true, confirm: true });
    assert.equal(fake.calls.length, 2);
    for (const c of fake.calls) assert.equal(c.url, "https://api.brevo.com/v3/contacts/doubleOptinConfirmation");
    assert.deepEqual(fake.calls[0].body, {
      email: "en@example.com",
      includeListIds: [7],
      templateId: 12,
      redirectionUrl: "https://orvixnet.com/research/subscribe/?confirmed=1",
      attributes: { LANGUAGE: "en" },
    });
    assert.equal(fake.calls[1].body.redirectionUrl, "https://orvixnet.com/ar/research/subscribe/?confirmed=1");
    assert.deepEqual(fake.calls[1].body.attributes, { LANGUAGE: "ar" });
  });

  test("double opt-in without SITE_URL -> 503", async () => {
    const fake = fakeContacts();
    const res = await make({ ...SUB_ENV, BREVO_DOI_TEMPLATE_ID: "12" }, fake)(subReq({ email: "a@b.co" }));
    assert.equal(res.status, 503);
  });

  test("throttle: 3 per email, 5 per IP per 15 minutes (still 200, no Brevo call)", async () => {
    const fake = fakeContacts();
    const h = make(SUB_ENV, fake);
    for (let i = 0; i < 4; i++) {
      const res = await h(subReq({ email: "same@example.com" }, { ip: `10.0.0.${i}` }));
      assert.equal(res.status, 200);
      assert.equal((await res.json()).ok, true);
    }
    assert.equal(fake.calls.length, 3);

    const fake2 = fakeContacts();
    const h2 = make(SUB_ENV, fake2);
    for (let i = 0; i < 6; i++) assert.equal((await h2(subReq({ email: `p${i}@example.com` }, { ip: "1.2.3.4" }))).status, 200);
    assert.equal(fake2.calls.length, 5);
  });

  test("Brevo 500 or network error -> 502 without echoing the email", async () => {
    const fake = fakeContacts(() => new Response("oops", { status: 500 }));
    const res = await make(SUB_ENV, fake)(subReq({ email: "secret@example.com" }));
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: "We could not add you right now. Please try again later." });
    assert.ok(!text.includes("secret@example.com"));
    const down = createHandler({ env: SUB_ENV, now: () => NOW, throttle: new Map(), fetchImpl: async () => { throw new Error("down"); } });
    assert.equal((await down(subReq({ email: "a@b.co" }))).status, 502);
  });
});

// ---------------------------------------------------------------- newsletter drafts on first publish

import { fillTemplate, createNewsletterDrafts } from "../lib/newsletter.mjs";
import { readFile as fsReadFile } from "node:fs/promises";

describe("newsletter drafts", () => {
  const TPL =
    `<!-- docs: fill {{ params.ARTICLE_TITLE }}; delete {% if ... %} to {% endif %} -->` +
    `<!--[if mso]><v:roundrect href="{{ params.ARTICLE_URL }}"><![endif]-->` +
    `<div class="pre">{{ params.PREHEADER }}</div><p class="intro">{{params.INTRO}}</p>` +
    `<img src="{{ params.COVER_URL }}" alt="{{ params.ARTICLE_TITLE }}"><h1>{{   params.ARTICLE_TITLE   }}</h1>` +
    `<p class="sum">{{ params.ARTICLE_SUMMARY }}</p><a class="btn" href="{{ params.ARTICLE_URL }}">Read</a>` +
    `{{ params.UNKNOWN }}{% if params.ALSO_TITLE %}<b>{{ params.ALSO_TITLE }}</b>{% endif %}` +
    `<a href="{{ mirror }}">web</a><a href="{{ unsubscribe }}">unsubscribe</a>`;
  const readFile = async (p) => (String(p).includes("-ar.html") ? "AR|" + TPL : "EN|" + TPL);

  const NL_ENV = {
    ...ENV,
    NEWSLETTER_FROM_EMAIL: "news@orvixnet.com",
    BREVO_LIST_ID: "3",
    BREVO_LIST_ID_AR: "4",
  };

  /** Routes GitHub calls to the fake repo and records Brevo campaign calls. */
  function fakeAll(files = {}, brevoRespond = () => new Response(JSON.stringify({ id: 101 }), { status: 201 })) {
    const gh = fakeGitHub(files);
    const campaigns = [];
    async function fetchImpl(url, init = {}) {
      if (String(url).startsWith("https://api.github.com/")) return gh.fetchImpl(url, init);
      assert.equal(url, "https://api.brevo.com/v3/emailCampaigns");
      const body = JSON.parse(init.body);
      campaigns.push({ headers: init.headers, body });
      return brevoRespond(body);
    }
    return { fetchImpl, gh, campaigns };
  }

  const bilingual = (over = {}) =>
    goodPost({
      status: "published",
      title: { en: "AI & boards", ar: "الذكاء الاصطناعي" },
      summary: { en: "Why it matters.", ar: "" },
      body: { en: "Body", ar: "نص" },
      ...over,
    });

  const put = (handler, post) =>
    handler(req("/api/posts/my-first-post", { method: "PUT", headers: writeHeaders, body: { post, cover_upload: null } }));

  test("fillTemplate escapes values, removes the ALSO block, keeps unsubscribe/mirror", () => {
    const out = fillTemplate(TPL, {
      ARTICLE_TITLE: `<script>alert("x")</script> & 'q'`,
      ARTICLE_URL: "https://orvixnet.com/a/",
      ALSO_TITLE: "should not appear",
    });
    assert.ok(!out.includes("<script>"));
    assert.ok(out.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;"));
    assert.ok(!out.includes("should not appear"));
    assert.ok(!out.includes("{%"));
    assert.ok(!out.includes("params."));
    assert.ok(out.includes('<a href="{{ unsubscribe }}">'));
    assert.ok(out.includes('<a href="{{ mirror }}">'));
    assert.ok(out.includes('<!--[if mso]><v:roundrect href="https://orvixnet.com/a/"><![endif]-->'));
  });

  test("the real templates fill cleanly", async () => {
    for (const file of ["perspectives-newsletter.html", "perspectives-newsletter-ar.html"]) {
      const html = await fsReadFile(new URL(`../../email/${file}`, import.meta.url), "utf8");
      const out = fillTemplate(html, { ARTICLE_TITLE: "T", ARTICLE_URL: "https://orvixnet.com/x/" });
      assert.ok(!/\{\{\s*params\./.test(out), file);
      assert.ok(!out.includes("{%"), file);
      assert.ok(out.includes('href="{{ unsubscribe }}"'), file);
      assert.ok(out.includes('href="{{ mirror }}"'), file);
      assert.ok(out.includes("<!--[if mso]>"), file);
    }
  });

  test("first publish creates EN + AR drafts with the right lists, sender, subject and URLs", async () => {
    const f = fakeAll();
    const handler = createHandler({ env: NL_ENV, now: () => NOW, fetchImpl: f.fetchImpl, readFile });
    const res = await put(handler, bilingual());
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.deepEqual(out.newsletter, {
      created: [{ lang: "en", id: 101, list: true }, { lang: "ar", id: 101, list: true }],
      skipped: [],
      errors: [],
    });
    assert.equal(f.campaigns.length, 2);
    const [en, ar] = f.campaigns;
    for (const c of f.campaigns) {
      assert.equal(c.headers["User-Agent"], "orvix-site/1.0");
      assert.equal(c.headers["api-key"], "xkeysib-test");
      assert.equal(c.headers.Accept, "application/json");
      assert.deepEqual(c.body.sender, { name: "Orvix", email: "news@orvixnet.com" });
      assert.equal(c.body.replyTo, "news@orvixnet.com");
      assert.equal(c.body.mirrorActive, true);
      // No cover -> hero fallback.
      assert.ok(c.body.htmlContent.includes('src="https://orvixnet.com/images/hero-perspectives.jpg"'));
      assert.ok(c.body.htmlContent.includes('href="{{ unsubscribe }}"'));
      assert.equal(c.body.scheduledAt, undefined);
    }
    assert.deepEqual(en.body.recipients, { listIds: [3] });
    assert.equal(en.body.subject, "AI & boards");
    assert.equal(en.body.name, "Perspectives · AI & boards (EN) · 2026-10-01");
    assert.equal(en.body.previewText, "Why it matters.");
    assert.ok(en.body.htmlContent.startsWith("EN|"));
    assert.ok(en.body.htmlContent.includes('href="https://orvixnet.com/research/perspectives/my-first-post/"'));
    assert.ok(en.body.htmlContent.includes("<h1>AI &amp; boards</h1>"));
    assert.ok(en.body.htmlContent.includes("A new piece from Orvix Perspectives."));

    assert.deepEqual(ar.body.recipients, { listIds: [4] });
    assert.equal(ar.body.subject, "الذكاء الاصطناعي");
    assert.equal(ar.body.name, "Perspectives · الذكاء الاصطناعي (AR) · 2026-10-01");
    assert.equal(ar.body.previewText, "Why it matters."); // falls back to the English summary
    assert.ok(ar.body.htmlContent.startsWith("AR|"));
    assert.ok(ar.body.htmlContent.includes('href="https://orvixnet.com/ar/research/perspectives/my-first-post/"'));
    assert.ok(ar.body.htmlContent.includes("مقال جديد من وجهات نظر Orvix."));
  });

  test("cover path becomes an absolute URL; preview text is capped at 150 chars", async () => {
    const f = fakeAll();
    const r = await createNewsletterDrafts({
      post: { ...bilingual({ summary: { en: "s".repeat(300) } }), slug: "x", cover: "/images/posts/x.webp" },
      env: NL_ENV,
      fetchImpl: f.fetchImpl,
      readFile,
      now: () => NOW,
    });
    assert.equal(r.created.length, 2);
    assert.ok(f.campaigns[0].body.htmlContent.includes('src="https://orvixnet.com/images/posts/x.webp"'));
    assert.equal(f.campaigns[0].body.previewText.length, 150);
  });

  test("English-only post or missing Arabic list -> Arabic skipped", async () => {
    const f = fakeAll();
    const r1 = await createNewsletterDrafts({
      post: bilingual({ title: { en: "T" }, body: { en: "B" } }), env: NL_ENV, fetchImpl: f.fetchImpl, readFile, now: () => NOW,
    });
    assert.deepEqual(r1.skipped, [{ lang: "ar", reason: "no Arabic text" }]);
    const r2 = await createNewsletterDrafts({
      post: bilingual(), env: { ...NL_ENV, BREVO_LIST_ID_AR: "" }, fetchImpl: f.fetchImpl, readFile, now: () => NOW,
    });
    assert.deepEqual(r2.skipped, [{ lang: "ar", reason: "no list id" }]);
    assert.equal(r2.created.length, 1);
  });

  test("saving as draft -> no drafts and no newsletter key", async () => {
    const f = fakeAll();
    const handler = createHandler({ env: NL_ENV, now: () => NOW, fetchImpl: f.fetchImpl, readFile });
    const out = await (await put(handler, bilingual({ status: "draft" }))).json();
    assert.equal(out.ok, true);
    assert.ok(!("newsletter" in out));
    assert.equal(f.campaigns.length, 0);
  });

  test("re-saving an already published post -> no drafts and no newsletter key", async () => {
    const existing = JSON.stringify({ ...bilingual(), published: "2026-09-01", updated: "2026-09-01T00:00:00Z", cover: "" });
    const f = fakeAll({ "content/posts/my-first-post.json": existing });
    const handler = createHandler({ env: NL_ENV, now: () => NOW, fetchImpl: f.fetchImpl, readFile });
    const res = await put(handler, bilingual());
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.ok(!("newsletter" in out));
    assert.equal(f.campaigns.length, 0);
  });

  test("re-publishing after an unpublish creates drafts again", async () => {
    const existing = JSON.stringify({ ...bilingual(), status: "draft", published: "2026-09-01" });
    const f = fakeAll({ "content/posts/my-first-post.json": existing });
    const handler = createHandler({ env: NL_ENV, now: () => NOW, fetchImpl: f.fetchImpl, readFile });
    const out = await (await put(handler, bilingual())).json();
    assert.equal(out.newsletter.created.length, 2);
  });

  test("Brevo 400 for one language -> save still 200, error listed", async () => {
    const f = fakeAll({}, (body) =>
      body.recipients.listIds[0] === 4
        ? new Response(JSON.stringify({ code: "invalid_parameter", message: "  sender is not valid  " }), { status: 400 })
        : new Response(JSON.stringify({ id: 7 }), { status: 201 }),
    );
    const handler = createHandler({ env: NL_ENV, now: () => NOW, fetchImpl: f.fetchImpl, readFile });
    const res = await put(handler, bilingual());
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.equal(out.ok, true);
    assert.ok(f.gh.store.has("content/posts/my-first-post.json"));
    assert.deepEqual(out.newsletter, {
      created: [{ lang: "en", id: 7, list: true }],
      skipped: [],
      errors: [{ lang: "ar", message: "sender is not valid" }],
    });
  });

  test("'no contacts associated' -> retried without recipients, created with list:false", async () => {
    // Arabic list "looks empty" to Brevo; the retry without recipients succeeds.
    const f = fakeAll({}, (body) =>
      body.recipients?.listIds[0] === 4
        ? new Response(JSON.stringify({ code: "invalid_parameter", message: "There are no contacts associated with the given recipients info" }), { status: 400 })
        : new Response(JSON.stringify({ id: body.recipients ? 9 : 10 }), { status: 201 }),
    );
    const handler = createHandler({ env: NL_ENV, now: () => NOW, fetchImpl: f.fetchImpl, readFile });
    const out = await (await put(handler, bilingual())).json();
    assert.deepEqual(out.newsletter, {
      created: [{ lang: "en", id: 9, list: true }, { lang: "ar", id: 10, list: false }],
      skipped: [],
      errors: [],
    });
    assert.equal(f.campaigns.length, 3);
    const [, arFirst, arRetry] = f.campaigns;
    assert.deepEqual(arFirst.body.recipients, { listIds: [4] });
    assert.ok(!("recipients" in arRetry.body));
    const { recipients, ...rest } = arFirst.body;
    assert.deepEqual(arRetry.body, rest); // otherwise identical
    assert.equal(arRetry.headers["User-Agent"], "orvix-site/1.0");
  });

  test("'no contacts associated' and the retry fails too -> error", async () => {
    const f = fakeAll({}, (body) =>
      body.recipients
        ? new Response(JSON.stringify({ code: "invalid_parameter", message: "There are no contacts associated with the given recipients info" }), { status: 400 })
        : new Response(JSON.stringify({ code: "invalid_parameter", message: "Sender is invalid / inactive" }), { status: 400 }),
    );
    const r = await createNewsletterDrafts({
      post: bilingual({ title: { en: "T" }, body: { en: "B" } }), env: NL_ENV, fetchImpl: f.fetchImpl, readFile, now: () => NOW,
    });
    assert.equal(f.campaigns.length, 2);
    assert.deepEqual(r.created, []);
    assert.deepEqual(r.errors, [{ lang: "en", message: "Sender is invalid / inactive" }]);
  });

  test("other 400s are not retried", async () => {
    const f = fakeAll({}, () =>
      new Response(JSON.stringify({ code: "invalid_parameter", message: "Sender is invalid / inactive" }), { status: 400 }),
    );
    const r = await createNewsletterDrafts({
      post: bilingual({ title: { en: "T" }, body: { en: "B" } }), env: NL_ENV, fetchImpl: f.fetchImpl, readFile, now: () => NOW,
    });
    assert.equal(f.campaigns.length, 1);
    assert.deepEqual(r.errors, [{ lang: "en", message: "Sender is invalid / inactive" }]);
  });

  test("network failure or missing template never fails the save", async () => {
    const gh = fakeGitHub();
    const fetchImpl = async (url, init) => {
      if (String(url).startsWith("https://api.github.com/")) return gh.fetchImpl(url, init);
      throw new Error("brevo down");
    };
    const handler = createHandler({ env: NL_ENV, now: () => NOW, fetchImpl, readFile });
    const out = await (await put(handler, bilingual())).json();
    assert.equal(out.ok, true);
    assert.deepEqual(out.newsletter.errors.map((e) => e.lang), ["en", "ar"]);

    const gh2 = fakeGitHub();
    const h2 = createHandler({
      env: NL_ENV, now: () => NOW, readFile: async () => { throw new Error("ENOENT"); },
      fetchImpl: async (url, init) =>
        String(url).startsWith("https://api.github.com/") ? gh2.fetchImpl(url, init) : new Response("", { status: 404 }),
    });
    const out2 = await (await put(h2, bilingual())).json();
    assert.equal(out2.ok, true);
    assert.match(out2.newsletter.errors[0].message, /template .* not found/);
  });

  test("not configured -> everything skipped, no Brevo call", async () => {
    const f = fakeAll();
    const handler = createHandler({ env: { ...NL_ENV, NEWSLETTER_FROM_EMAIL: "" }, now: () => NOW, fetchImpl: f.fetchImpl, readFile });
    const out = await (await put(handler, bilingual())).json();
    assert.equal(out.ok, true);
    assert.deepEqual(out.newsletter, {
      created: [],
      skipped: [{ lang: "en", reason: "not configured" }, { lang: "ar", reason: "not configured" }],
      errors: [],
    });
    assert.equal(f.campaigns.length, 0);
  });

  test("subscribe: Arabic subscriber goes to BREVO_LIST_ID_AR when set; User-Agent on Brevo calls", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(null, { status: 201 });
    };
    const headers = { "x-orvix-form": "1", "content-type": "application/json", origin: "https://orvixnet.com" };
    const sub = (env, body) =>
      createHandler({ env, now: () => NOW, fetchImpl, throttle: new Map() })(
        req("/api/subscribe", { method: "POST", token: null, headers, body }),
      );
    const base = { BREVO_API_KEY: "xkeysib-test", BREVO_LIST_ID: "3" };

    await sub({ ...base, BREVO_LIST_ID_AR: "4" }, { email: "ar@example.com", lang: "ar" });
    await sub({ ...base, BREVO_LIST_ID_AR: "4" }, { email: "en@example.com", lang: "en" });
    await sub({ ...base, BREVO_LIST_ID_AR: "nope" }, { email: "ar2@example.com", lang: "ar" });
    await sub(
      { ...base, BREVO_LIST_ID_AR: "4", BREVO_DOI_TEMPLATE_ID: "12", SITE_URL: "https://orvixnet.com" },
      { email: "ar3@example.com", lang: "ar" },
    );
    assert.deepEqual(calls.map((c) => c.body.listIds || c.body.includeListIds), [[4], [3], [3], [4]]);
    for (const c of calls) assert.equal(c.headers["User-Agent"], "orvix-site/1.0");

    // Login email carries it too.
    const mails = [];
    const h = createHandler({
      env: ENV, now: () => NOW, throttle: new Map(),
      fetchImpl: async (url, init) => { mails.push(init.headers); return new Response("{}", { status: 201 }); },
    });
    await h(req("/api/login", { method: "POST", token: null, headers: writeHeaders, body: { email: "editor@orvixnet.com" } }));
    assert.equal(mails.length, 1);
    assert.equal(mails[0]["User-Agent"], "orvix-site/1.0");
  });
});
