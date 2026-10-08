export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_PASSWORD: string; // mat khau dang nhap trang bao cao
  INGEST_KEY: string; // khoa Apps Script dung de day mail len
}

const STATUSES = ["moi", "dang_xu_ly", "cho_phan_hoi", "da_xong", "huy"] as const;
const CASE_CODE_RE = /\bCA-(\d{4})-(\d{5})\b/i;
const SESSION_DAYS = 30;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Lỗi máy chủ" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = req.method;

  if (p === "/api/ingest" && m === "POST") {
    if (!(await safeEqual(req.headers.get("X-Ingest-Key") ?? "", env.INGEST_KEY))) {
      throw new HttpError(401, "Sai INGEST_KEY");
    }
    return json(await ingest(env, await req.json()));
  }
  if (p === "/api/login" && m === "POST") return login(req, env);
  if (p === "/api/logout" && m === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": "sid=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
  }

  if (!(await checkSession(req, env))) throw new HttpError(401, "Chưa đăng nhập");

  if (p === "/api/me" && m === "GET") return json({ ok: true });
  if (p === "/api/stats" && m === "GET") return json(await stats(env));
  if (p === "/api/cases" && m === "GET") return json(await listCases(env, url.searchParams));
  if (p === "/api/export.csv" && m === "GET") return exportCsv(env);

  const caseMatch = p.match(/^\/api\/cases\/(CA-\d{4}-\d{5})$/i);
  if (caseMatch) {
    const code = caseMatch[1].toUpperCase();
    if (m === "GET") return json(await getCase(env, code));
    if (m === "PATCH") return json(await updateCase(env, code, await req.json()));
  }
  throw new HttpError(404, "Không tìm thấy");
}

// ---------------------------------------------------------------- ingest

interface InMessage {
  gmailId: string;
  threadId?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date: string;
  body?: string;
  attachments?: { name: string; size: number; type: string }[];
}

async function ingest(env: Env, payload: unknown) {
  const list = (payload as { messages?: InMessage[] })?.messages;
  if (!Array.isArray(list)) throw new HttpError(400, "Thiếu messages[]");

  // Xu ly mail cu truoc de mail goc luon mo ca, mail tra loi gan vao sau.
  const sorted = list
    .filter((x) => x && typeof x.gmailId === "string" && x.gmailId)
    .map((x) => ({ ...x, sentAt: toIso(x.date) }))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  let inserted = 0;
  let duplicates = 0;
  const results: { gmailId: string; code: string; linkMethod: string }[] = [];

  for (const msg of sorted) {
    const messageId = cleanId(msg.messageId ?? "");
    const dup = await env.DB.prepare(
      "SELECT 1 FROM messages WHERE gmail_id = ?1 OR (?2 != '' AND message_id = ?2) LIMIT 1",
    )
      .bind(msg.gmailId, messageId)
      .first();
    if (dup) {
      duplicates++;
      continue;
    }

    const subject = (msg.subject ?? "").slice(0, 1000);
    const body = (msg.body ?? "").slice(0, 50_000);
    const from = parseAddress(msg.from ?? "");
    const refIds = [...extractIds(msg.inReplyTo ?? ""), ...extractIds(msg.references ?? "")];

    const { caseId, code, linkMethod } = await findOrCreateCase(env, {
      subject,
      body,
      refIds,
      threadId: msg.threadId ?? "",
      from,
      sentAt: msg.sentAt,
    });

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO messages (case_id, gmail_id, thread_id, message_id, in_reply_to, refs, from_name, from_email,
           to_addr, cc_addr, subject, sent_at, body, body_new, attachments, link_method)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
      ).bind(
        caseId,
        msg.gmailId,
        msg.threadId ?? "",
        messageId,
        cleanId(msg.inReplyTo ?? ""),
        refIds.join(" "),
        from.name,
        from.email,
        (msg.to ?? "").slice(0, 4000),
        (msg.cc ?? "").slice(0, 4000),
        subject,
        msg.sentAt,
        body,
        stripQuoted(body).slice(0, 20_000),
        JSON.stringify((msg.attachments ?? []).slice(0, 50)),
        linkMethod,
      ),
      // Mail den khong theo thu tu (vd CC vao giua luong) -> neu mail nay cu hon thi no moi la goc.
      env.DB.prepare(
        `UPDATE cases SET
           msg_count = msg_count + 1,
           last_from = CASE WHEN ?2 >= last_at THEN ?3 ELSE last_from END,
           last_at = MAX(last_at, ?2),
           subject = CASE WHEN ?2 < origin_at THEN ?4 ELSE subject END,
           origin_name = CASE WHEN ?2 < origin_at THEN ?5 ELSE origin_name END,
           origin_email = CASE WHEN ?2 < origin_at THEN ?3 ELSE origin_email END,
           origin_domain = CASE WHEN ?2 < origin_at THEN ?6 ELSE origin_domain END,
           origin_at = MIN(origin_at, ?2),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?1`,
      ).bind(caseId, msg.sentAt, from.email, subject, from.name, domainOf(from.email)),
    ]);

    inserted++;
    results.push({ gmailId: msg.gmailId, code, linkMethod });
  }
  return { ok: true, inserted, duplicates, results };
}

async function findOrCreateCase(
  env: Env,
  m: { subject: string; body: string; refIds: string[]; threadId: string; from: Addr; sentAt: string },
): Promise<{ caseId: number; code: string; linkMethod: string }> {
  // 1) Ma ca ghi trong tieu de / noi dung -> uu tien cao nhat (do nguoi dung chu dong gan).
  const codeHit = (m.subject.match(CASE_CODE_RE) ?? m.body.slice(0, 5000).match(CASE_CODE_RE))?.[0];
  if (codeHit) {
    const row = await env.DB.prepare("SELECT id, code FROM cases WHERE code = ?").bind(codeHit.toUpperCase()).first<CaseRef>();
    if (row) return { caseId: row.id, code: row.code, linkMethod: "ma-ca" };
  }

  // 2) Header In-Reply-To / References -> mail tra loi cua 1 mail da luu.
  const refs = m.refIds.slice(-50);
  if (refs.length) {
    const placeholders = refs.map((_, i) => `?${i + 1}`).join(",");
    const row = await env.DB.prepare(
      `SELECT c.id, c.code FROM messages m JOIN cases c ON c.id = m.case_id
       WHERE m.message_id IN (${placeholders}) ORDER BY m.sent_at LIMIT 1`,
    )
      .bind(...refs)
      .first<CaseRef>();
    if (row) return { caseId: row.id, code: row.code, linkMethod: "references" };
  }

  // 3) Cung luong Gmail.
  if (m.threadId) {
    const row = await env.DB.prepare(
      "SELECT c.id, c.code FROM messages m JOIN cases c ON c.id = m.case_id WHERE m.thread_id = ? LIMIT 1",
    )
      .bind(m.threadId)
      .first<CaseRef>();
    if (row) return { caseId: row.id, code: row.code, linkMethod: "thread" };
  }

  // 4) Mo ca moi. Nam theo gio Viet Nam cua mail goc.
  const year = new Date(Date.parse(m.sentAt) + 7 * 3600_000).getUTCFullYear();
  const counter = await env.DB.prepare(
    "INSERT INTO counters (year, n) VALUES (?1, 1) ON CONFLICT(year) DO UPDATE SET n = n + 1 RETURNING n",
  )
    .bind(year)
    .first<{ n: number }>();
  const code = `CA-${year}-${String(counter!.n).padStart(5, "0")}`;
  const created = await env.DB.prepare(
    `INSERT INTO cases (code, subject, origin_name, origin_email, origin_domain, origin_at, last_at, last_from)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?4) RETURNING id`,
  )
    .bind(code, m.subject, m.from.name, m.from.email, domainOf(m.from.email), m.sentAt)
    .first<{ id: number }>();
  return { caseId: created!.id, code, linkMethod: "moi" };
}

interface CaseRef {
  id: number;
  code: string;
}

// ---------------------------------------------------------------- doc / sua ca

async function listCases(env: Env, sp: URLSearchParams) {
  const where: string[] = [];
  const args: unknown[] = [];
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    args.push(`%${q}%`);
    const i = args.length;
    where.push(`(code LIKE ?${i} OR subject LIKE ?${i} OR origin_email LIKE ?${i} OR origin_name LIKE ?${i}
      OR customer LIKE ?${i} OR assignee LIKE ?${i} OR note LIKE ?${i}
      OR id IN (SELECT case_id FROM messages WHERE body LIKE ?${i} OR from_email LIKE ?${i}))`);
  }
  const status = sp.get("status");
  if (status && (STATUSES as readonly string[]).includes(status)) {
    args.push(status);
    where.push(`status = ?${args.length}`);
  }
  const from = sp.get("from"); // YYYY-MM-DD theo gio VN, loc theo ngay mo ca
  if (from) {
    args.push(from);
    where.push(`date(origin_at, '+7 hours') >= ?${args.length}`);
  }
  const to = sp.get("to");
  if (to) {
    args.push(to);
    where.push(`date(origin_at, '+7 hours') <= ?${args.length}`);
  }
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM cases ${whereSql}`).bind(...args).first<{ n: number }>();
  const rows = await env.DB.prepare(
    `SELECT code, subject, origin_name, origin_email, origin_domain, origin_at, last_at, last_from, msg_count,
            status, assignee, customer
     FROM cases ${whereSql} ORDER BY last_at DESC LIMIT 50 OFFSET ${(page - 1) * 50}`,
  )
    .bind(...args)
    .all();
  return { total: total?.n ?? 0, page, pageSize: 50, cases: rows.results };
}

async function getCase(env: Env, code: string) {
  const c = await env.DB.prepare("SELECT * FROM cases WHERE code = ?").bind(code).first<Record<string, unknown>>();
  if (!c) throw new HttpError(404, "Không có ca này");
  const msgs = await env.DB.prepare(
    `SELECT gmail_id, thread_id, message_id, from_name, from_email, to_addr, cc_addr, subject, sent_at,
            body, body_new, attachments, link_method
     FROM messages WHERE case_id = ? ORDER BY sent_at`,
  )
    .bind(c.id)
    .all();
  return { case: c, messages: msgs.results };
}

async function updateCase(env: Env, code: string, input: unknown) {
  const body = (input ?? {}) as Record<string, unknown>;
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const field of ["status", "assignee", "customer", "note"] as const) {
    if (typeof body[field] !== "string") continue;
    const value = (body[field] as string).trim().slice(0, field === "note" ? 5000 : 200);
    if (field === "status" && !(STATUSES as readonly string[]).includes(value)) {
      throw new HttpError(400, "Trạng thái không hợp lệ");
    }
    args.push(value);
    sets.push(`${field} = ?${args.length}`);
  }
  if (!sets.length) throw new HttpError(400, "Không có gì để cập nhật");
  args.push(code);
  const res = await env.DB.prepare(
    `UPDATE cases SET ${sets.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE code = ?${args.length}`,
  )
    .bind(...args)
    .run();
  if (!res.meta.changes) throw new HttpError(404, "Không có ca này");
  return { ok: true };
}

async function stats(env: Env) {
  const [byStatus, byDay, byMonth, byDomain, response, stale, totals] = await env.DB.batch([
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM cases GROUP BY status"),
    env.DB.prepare(
      `SELECT date(origin_at, '+7 hours') AS day, COUNT(*) AS n FROM cases
       WHERE origin_at >= datetime('now', '-30 days') GROUP BY day ORDER BY day`,
    ),
    env.DB.prepare(
      `SELECT strftime('%Y-%m', origin_at, '+7 hours') AS month, COUNT(*) AS n,
              SUM(status = 'da_xong') AS done FROM cases
       WHERE origin_at >= datetime('now', '-365 days') GROUP BY month ORDER BY month`,
    ),
    env.DB.prepare(
      `SELECT origin_domain AS domain, COUNT(*) AS n FROM cases GROUP BY origin_domain ORDER BY n DESC LIMIT 10`,
    ),
    // Thoi gian phan hoi dau tien = mail dau tien cua nguoi KHAC nguoi mo ca.
    env.DB.prepare(
      `SELECT AVG((julianday(r.first_reply) - julianday(c.origin_at)) * 24) AS avg_hours, COUNT(*) AS n
       FROM cases c JOIN (
         SELECT m.case_id, MIN(m.sent_at) AS first_reply FROM messages m JOIN cases c2 ON c2.id = m.case_id
         WHERE lower(m.from_email) != lower(c2.origin_email) GROUP BY m.case_id
       ) r ON r.case_id = c.id
       WHERE c.origin_at >= datetime('now', '-30 days')`,
    ),
    env.DB.prepare(
      `SELECT code, subject, last_at, status, assignee FROM cases
       WHERE status NOT IN ('da_xong', 'huy') AND last_at < datetime('now', '-3 days')
       ORDER BY last_at LIMIT 20`,
    ),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM cases) AS cases, (SELECT COUNT(*) FROM messages) AS messages,
              (SELECT MAX(created_at) FROM messages) AS last_sync`,
    ),
  ]);
  return {
    byStatus: byStatus.results,
    byDay: byDay.results,
    byMonth: byMonth.results,
    byDomain: byDomain.results,
    response: response.results[0],
    stale: stale.results,
    totals: totals.results[0],
  };
}

async function exportCsv(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT code, subject, origin_name, origin_email, origin_domain, origin_at, last_at, last_from, msg_count,
            status, assignee, customer, note FROM cases ORDER BY origin_at`,
  ).all<Record<string, unknown>>();
  const cols = ["code", "subject", "origin_name", "origin_email", "origin_domain", "origin_at", "last_at", "last_from",
    "msg_count", "status", "assignee", "customer", "note"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(","), ...rows.results.map((r) => cols.map((c) => esc(r[c])).join(","))];
  return new Response("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cac-ca-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

// ---------------------------------------------------------------- dang nhap

async function login(req: Request, env: Env): Promise<Response> {
  const { password } = ((await req.json().catch(() => ({}))) ?? {}) as { password?: string };
  if (!env.APP_PASSWORD || !(await safeEqual(String(password ?? ""), env.APP_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 800));
    throw new HttpError(401, "Sai mật khẩu");
  }
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const token = `${exp}.${await sign(env, String(exp))}`;
  return json({ ok: true }, 200, {
    "Set-Cookie": `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

async function checkSession(req: Request, env: Env): Promise<boolean> {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.get("Cookie") ?? "")?.[1];
  if (!sid) return false;
  const [exp, sig] = sid.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await sign(env, exp));
}

// Khoa ky gom ca mat khau -> doi APP_PASSWORD la moi phien dang nhap cu het hieu luc.
async function sign(env: Env, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${env.INGEST_KEY}|${env.APP_PASSWORD}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------- tien ich

interface Addr {
  name: string;
  email: string;
}

function parseAddress(raw: string): Addr {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: raw.trim().toLowerCase() };
}

function domainOf(email: string): string {
  return email.includes("@") ? email.split("@").pop()! : "";
}

function cleanId(raw: string): string {
  return raw.trim().replace(/^<|>$/g, "");
}

function extractIds(raw: string): string[] {
  return [...raw.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]);
}

function toIso(date: string): string {
  const t = Date.parse(date);
  return new Date(Number.isNaN(t) ? Date.now() : t).toISOString();
}

// Cat phan trich dan mail cu (Gmail/Outlook, tieng Viet/Anh) de chi giu noi dung moi.
function stripQuoted(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const markers = [
    /^On .+wrote:\s*$/i,
    /^Vào .+đã viết:\s*$/i,
    /^-{2,}\s*(Original Message|Forwarded message|Thư gốc|Tin nhắn đã chuyển tiếp)/i,
    /^(From|Từ):\s.+/i,
    /^_{10,}\s*$/,
  ];
  const out: string[] = [];
  for (const line of lines) {
    if (markers.some((re) => re.test(line.trim()))) break;
    if (line.trimStart().startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
