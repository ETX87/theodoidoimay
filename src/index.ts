import { caseTheoId, caseTheoSerial, type DvbhCase } from "./dvbh";
import {
  bangDeXuat,
  domainOf,
  laThuDeXuat,
  laThuDuyet,
  parseAddress,
  phanMoi,
  phanTichTieuDe,
  tachTrichDan,
  tatCaEmail,
  timSerial,
} from "./parse";

export interface Env {
  DB: D1Database; // thuky-mail-db
  DVBH_DB: D1Database; // dvbh-db-smarttrade - CHI DOC (src/dvbh.ts)
  THU: R2Bucket; // toan van thu
  ASSETS: Fetcher;
  ALLOWED_DOMAINS: string; // "dichvu3t.com,karofi.vn"
  APP_PASSWORD: string;
  INGEST_KEY: string;
}

const MATCH_STATUSES = ["da_gan", "chua_gan", "nhieu_ung_vien", "cho_dvbh"] as const;
const MA_CASE_RE = /^(\d{6,8}|SC\d{6,12})$/i;
const SESSION_DAYS = 30;
const BO_QUA_GIU_NGAY = 90;
const SERIAL_GOM_NGAY = 90;
const LECH_TRICH_DAN_MS = 2 * 60_000;
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

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

  // Doi soat dem: gan lai luong chua gan (DVBH import tre), don bo_qua qua han.
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    const pending = await env.DB.prepare(
      "SELECT id FROM luong WHERE match_status != 'da_gan' ORDER BY last_at DESC LIMIT 200",
    ).all<{ id: number }>();
    for (const { id } of pending.results) await ganDvbh(env, id);
    await env.DB.prepare(`DELETE FROM bo_qua WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${BO_QUA_GIU_NGAY} days')`).run();
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
  if (p === "/api/luong" && m === "GET") return json(await listLuong(env, url.searchParams));
  if (p === "/api/bo-qua" && m === "GET") {
    return json((await env.DB.prepare("SELECT * FROM bo_qua ORDER BY sent_at DESC LIMIT 200").all()).results);
  }

  const byCase = p.match(/^\/api\/case\/([A-Za-z0-9]+)$/);
  if (byCase && m === "GET") {
    const row = await env.DB.prepare("SELECT id FROM luong WHERE dvbh_case_id = ?").bind(byCase[1].toUpperCase()).first<{ id: number }>();
    return json(row ? await getLuong(env, row.id) : { luong: null, thu: [] });
  }

  const byId = p.match(/^\/api\/luong\/(\d+)$/);
  if (byId) {
    const id = Number(byId[1]);
    if (m === "GET") return json(await getLuong(env, id));
    if (m === "PATCH") return json(await updateLuong(env, id, await req.json()));
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
  html?: string;
  attachments?: { name: string; size: number; type: string }[];
}

interface LuongRow {
  id: number;
  dvbh_case_id: string | null;
  match_status: string;
  ma_trong_mail: string;
  serial: string;
  loai_yeu_cau: string;
  de_xuat_json: string;
}

async function ingest(env: Env, payload: unknown) {
  const list = (payload as { messages?: InMessage[] })?.messages;
  if (!Array.isArray(list)) throw new HttpError(400, "Thiếu messages[]");
  const allowed = env.ALLOWED_DOMAINS.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);

  // Cu truoc moi sau: thu goc mo luong, thu tra loi gan vao sau.
  const sorted = list
    .filter((x) => x && typeof x.gmailId === "string" && x.gmailId)
    .map((x) => ({ ...x, sentAt: toIso(x.date) }))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  const out = { ok: true, inserted: 0, duplicates: 0, skipped: 0, quoted: 0, htmlBoSung: 0, results: [] as unknown[] };

  for (const msg of sorted) {
    const messageId = cleanId(msg.messageId ?? "");
    const dup = await env.DB.prepare(
      `SELECT 1 FROM thu WHERE gmail_id = ?1 OR (?2 != '' AND message_id = ?2)
       UNION ALL SELECT 1 FROM bo_qua WHERE gmail_id = ?1 LIMIT 1`,
    )
      .bind(msg.gmailId, messageId)
      .first();
    if (dup) {
      out.duplicates++;
      if (msg.html) await boSungHtml(env, msg, out);
      continue;
    }

    const from = parseAddress(msg.from ?? "");
    const subject = (msg.subject ?? "").slice(0, 1000);

    // Lop A: khong co ai thuoc ten mien nghiep vu -> chi ghi nhat ky.
    const emails = tatCaEmail(msg.from ?? "", msg.to ?? "", msg.cc ?? "");
    if (!emails.some((e) => allowed.includes(domainOf(e)))) {
      await env.DB.prepare("INSERT OR IGNORE INTO bo_qua (gmail_id, from_email, subject, sent_at, ly_do) VALUES (?, ?, ?, ?, ?)")
        .bind(msg.gmailId, from.email, subject, msg.sentAt, "ngoai_ten_mien")
        .run();
      out.skipped++;
      continue;
    }

    const body = msg.body ?? "";
    const html = msg.html ?? "";
    const tieuDe = phanTichTieuDe(subject);
    const bang = bangDeXuat(html);
    const maBang = (bang["Mã Yêu Cầu"] ?? "").trim();
    const maCase = tieuDe.maCase || (MA_CASE_RE.test(maBang) ? maBang.toUpperCase() : "");
    const serial = tieuDe.serial || timSerial(bang["Số Serial"] ?? "") || timSerial(body.slice(0, 20_000));
    const refIds = [...extractIds(msg.inReplyTo ?? ""), ...extractIds(msg.references ?? "")];

    const { luongId, method } = await timLuong(env, { maCase, refIds, threadId: msg.threadId ?? "", serial, sentAt: msg.sentAt });

    const r2Key = `thu/${msg.gmailId}.json`;
    await env.THU.put(r2Key, JSON.stringify({ subject, from: msg.from, to: msg.to, cc: msg.cc, body, html }), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });

    const bodyNew = phanMoi(body).slice(0, 20_000);
    const values = {
      luongId,
      nguon: "gmail",
      gmailId: msg.gmailId,
      threadId: msg.threadId ?? "",
      messageId,
      inReplyTo: cleanId(msg.inReplyTo ?? ""),
      refs: refIds.join(" "),
      from,
      to: (msg.to ?? "").slice(0, 4000),
      cc: (msg.cc ?? "").slice(0, 4000),
      subject,
      sentAt: msg.sentAt,
      bodyNew,
      r2Key,
      attachments: JSON.stringify((msg.attachments ?? []).slice(0, 50)),
      method,
      laDeXuat: laThuDeXuat(from.email, msg.to ?? "", tieuDe) ? 1 : 0,
      laDuyet: laThuDuyet(from.email, bodyNew) ? 1 : 0,
    };

    // Thu that thay cho ban trich dan da luu truoc do (cung nguoi gui, lech <= 2 phut).
    const quotedTwin = await timThuGan(env, from.email, msg.sentAt, "trich_dan");
    if (quotedTwin) await env.DB.prepare("DELETE FROM thu WHERE id = ?").bind(quotedTwin.id).run();
    await insertThu(env, values);
    if (quotedTwin && quotedTwin.luongId !== luongId) await gopLuong(env, quotedTwin.luongId, luongId);

    // Chuoi thu cu nam trong phan trich dan -> biet ai mo luong, luc nao.
    for (const q of tachTrichDan(body)) {
      if (!q.from.email || (await timThuGan(env, q.from.email, q.sentAt))) continue;
      const qTieuDe = phanTichTieuDe(q.subject);
      const qBody = phanMoi(q.body);
      await insertThu(env, {
        ...values,
        nguon: "trich_dan",
        gmailId: `q_${await hash(`${q.from.email}|${q.sentAt.slice(0, 16)}|${qTieuDe.goc}`)}`,
        messageId: "",
        inReplyTo: "",
        refs: "",
        from: q.from,
        to: q.to.slice(0, 4000),
        cc: q.cc.slice(0, 4000),
        subject: q.subject.slice(0, 1000),
        sentAt: q.sentAt,
        bodyNew: qBody.slice(0, 20_000),
        r2Key: "",
        attachments: "[]",
        method: "trich_dan",
        laDeXuat: laThuDeXuat(q.from.email, q.to, qTieuDe) ? 1 : 0,
        laDuyet: laThuDuyet(q.from.email, qBody) ? 1 : 0,
      });
      out.quoted++;
    }

    await env.DB.prepare(
      `UPDATE luong SET
         ma_trong_mail = CASE WHEN ma_trong_mail = '' THEN ?2 ELSE ma_trong_mail END,
         serial = CASE WHEN serial = '' THEN ?3 ELSE serial END,
         loai_yeu_cau = CASE WHEN loai_yeu_cau = '' THEN ?4 ELSE loai_yeu_cau END,
         de_xuat_json = CASE WHEN de_xuat_json = '{}' THEN ?5 ELSE de_xuat_json END
       WHERE id = ?1`,
    )
      .bind(luongId, maCase, serial, tieuDe.loai, JSON.stringify(bang))
      .run();

    const finalId = await ganDvbh(env, luongId);
    out.inserted++;
    out.results.push({ gmailId: msg.gmailId, luongId: finalId, method, maCase, serial });
  }
  return out;
}

/**
 * Thu da luu tu ban Apps Script cu (khong co HTML) duoc gui lai kem HTML -> bo sung toan van vao R2 va
 * bang de xuat cho luong neu luong chua co. Khong xoa/them thu nao.
 */
async function boSungHtml(env: Env, msg: InMessage & { sentAt: string }, out: { htmlBoSung?: number }): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT t.luong_id, t.r2_key, l.de_xuat_json FROM thu t JOIN luong l ON l.id = t.luong_id
     WHERE t.gmail_id = ? AND t.nguon = 'gmail'`,
  )
    .bind(msg.gmailId)
    .first<{ luong_id: number; r2_key: string; de_xuat_json: string }>();
  if (!row?.r2_key) return;
  const cu = await env.THU.get(row.r2_key);
  const daCoHtml = cu ? Boolean(((await cu.json()) as { html?: string }).html) : false;
  if (daCoHtml) return;
  await env.THU.put(
    row.r2_key,
    JSON.stringify({ subject: msg.subject, from: msg.from, to: msg.to, cc: msg.cc, body: msg.body ?? "", html: msg.html }),
    { httpMetadata: { contentType: "application/json; charset=utf-8" } },
  );
  const bang = bangDeXuat(msg.html ?? "");
  if (row.de_xuat_json === "{}" && Object.keys(bang).length) {
    await env.DB.prepare("UPDATE luong SET de_xuat_json = ? WHERE id = ?").bind(JSON.stringify(bang), row.luong_id).run();
  }
  out.htmlBoSung = (out.htmlBoSung ?? 0) + 1;
}

async function timLuong(
  env: Env,
  m: { maCase: string; refIds: string[]; threadId: string; serial: string; sentAt: string },
): Promise<{ luongId: number; method: string }> {
  if (m.maCase) {
    const row = await env.DB.prepare("SELECT id FROM luong WHERE dvbh_case_id = ?1 OR ma_trong_mail = ?1 LIMIT 1")
      .bind(m.maCase)
      .first<{ id: number }>();
    if (row) return { luongId: row.id, method: "ma_case" };
  }
  const refs = m.refIds.slice(-50);
  if (refs.length) {
    const row = await env.DB.prepare(
      `SELECT luong_id AS id FROM thu WHERE message_id IN (${refs.map((_, i) => `?${i + 1}`).join(",")}) LIMIT 1`,
    )
      .bind(...refs)
      .first<{ id: number }>();
    if (row) return { luongId: row.id, method: "references" };
  }
  if (m.threadId) {
    const row = await env.DB.prepare("SELECT luong_id AS id FROM thu WHERE thread_id = ? LIMIT 1").bind(m.threadId).first<{ id: number }>();
    if (row) return { luongId: row.id, method: "thread" };
  }
  if (m.serial) {
    const row = await env.DB.prepare(
      `SELECT id FROM luong WHERE serial = ?1 AND last_at >= strftime('%Y-%m-%dT%H:%M:%fZ', ?2, '-${SERIAL_GOM_NGAY} days') ORDER BY last_at DESC LIMIT 1`,
    )
      .bind(m.serial, m.sentAt)
      .first<{ id: number }>();
    if (row) return { luongId: row.id, method: "serial" };
  }
  const created = await env.DB.prepare("INSERT INTO luong (origin_at, last_at) VALUES (?1, ?1) RETURNING id")
    .bind(m.sentAt)
    .first<{ id: number }>();
  return { luongId: created!.id, method: "moi" };
}

/** Tim thu cung nguoi gui, lech <= 2 phut (de khong luu trung thu that va ban trich dan). */
async function timThuGan(
  env: Env,
  email: string,
  sentAt: string,
  nguon?: string,
): Promise<{ id: number; luongId: number } | null> {
  const t = Date.parse(sentAt);
  const row = await env.DB.prepare(
    `SELECT id, luong_id AS luongId FROM thu WHERE from_email = ?1 AND sent_at BETWEEN ?2 AND ?3 ${nguon ? "AND nguon = ?4" : ""} LIMIT 1`,
  )
    .bind(email, new Date(t - LECH_TRICH_DAN_MS).toISOString(), new Date(t + LECH_TRICH_DAN_MS).toISOString(), ...(nguon ? [nguon] : []))
    .first<{ id: number; luongId: number }>();
  return row ?? null;
}

interface ThuValues {
  luongId: number;
  nguon: string;
  gmailId: string;
  threadId: string;
  messageId: string;
  inReplyTo: string;
  refs: string;
  from: { name: string; email: string };
  to: string;
  cc: string;
  subject: string;
  sentAt: string;
  bodyNew: string;
  r2Key: string;
  attachments: string;
  method: string;
  laDeXuat: number;
  laDuyet: number;
}

async function insertThu(env: Env, v: ThuValues): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO thu (luong_id, nguon, gmail_id, thread_id, message_id, in_reply_to, refs, from_name, from_email,
       to_addr, cc_addr, subject, sent_at, body_new, r2_key, attachments, link_method, la_de_xuat, la_duyet)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
  )
    .bind(v.luongId, v.nguon, v.gmailId, v.threadId, v.messageId, v.inReplyTo, v.refs, v.from.name, v.from.email,
      v.to, v.cc, v.subject, v.sentAt, v.bodyNew, v.r2Key, v.attachments, v.method, v.laDeXuat, v.laDuyet)
    .run();
}

/**
 * Xac dinh case DVBH cho luong (theo ma trong mail, roi theo serial), gop luong neu case da co luong khac,
 * roi tinh lai cac moc. Tra ve id luong cuoi cung (co the khac neu bi gop).
 */
async function ganDvbh(env: Env, luongId: number): Promise<number> {
  const l = await env.DB.prepare("SELECT * FROM luong WHERE id = ?").bind(luongId).first<LuongRow>();
  if (!l) return luongId;

  if (l.match_status !== "da_gan") {
    let found: DvbhCase | null = null;
    let status = "chua_gan";
    let note = "";
    if (l.ma_trong_mail) {
      found = await caseTheoId(env.DVBH_DB, l.ma_trong_mail);
      if (!found) {
        status = "cho_dvbh";
        note = JSON.stringify({ ly_do: "DVBH chưa có case này", ma: l.ma_trong_mail });
      }
    }
    if (!found && l.serial) {
      const list = await caseTheoSerial(env.DVBH_DB, l.serial);
      if (list.length === 1) found = list[0];
      else if (list.length > 1 && status !== "cho_dvbh") {
        status = "nhieu_ung_vien";
        note = JSON.stringify({ ly_do: "Serial khớp nhiều case", ung_vien: list.map((c) => c.id) });
      }
    }

    if (found) {
      const other = await env.DB.prepare("SELECT id FROM luong WHERE dvbh_case_id = ? AND id != ?")
        .bind(found.id, luongId)
        .first<{ id: number }>();
      if (other) {
        await gopLuong(env, luongId, other.id);
        return other.id;
      }
      await env.DB.prepare(
        `UPDATE luong SET dvbh_case_id = ?2, match_status = 'da_gan', match_note = '', dvbh_json = ?3,
           dvbh_checked_at = ${NOW_SQL} WHERE id = ?1`,
      )
        .bind(luongId, found.id, JSON.stringify(found))
        .run();
    } else {
      await env.DB.prepare(`UPDATE luong SET match_status = ?2, match_note = ?3, dvbh_checked_at = ${NOW_SQL} WHERE id = ?1`)
        .bind(luongId, status, note)
        .run();
    }
  }
  await tinhLaiMoc(env, luongId);
  return luongId;
}

async function gopLuong(env: Env, tu: number, vao: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE thu SET luong_id = ?2 WHERE luong_id = ?1").bind(tu, vao),
    env.DB.prepare(
      `UPDATE luong SET
         ma_trong_mail = CASE WHEN ma_trong_mail = '' THEN (SELECT ma_trong_mail FROM luong WHERE id = ?1) ELSE ma_trong_mail END,
         serial = CASE WHEN serial = '' THEN (SELECT serial FROM luong WHERE id = ?1) ELSE serial END,
         loai_yeu_cau = CASE WHEN loai_yeu_cau = '' THEN (SELECT loai_yeu_cau FROM luong WHERE id = ?1) ELSE loai_yeu_cau END,
         de_xuat_json = CASE WHEN de_xuat_json = '{}' THEN (SELECT de_xuat_json FROM luong WHERE id = ?1) ELSE de_xuat_json END,
         ghi_chu = trim(ghi_chu || ' ' || (SELECT ghi_chu FROM luong WHERE id = ?1))
       WHERE id = ?2`,
    ).bind(tu, vao),
    env.DB.prepare("DELETE FROM luong WHERE id = ?").bind(tu),
  ]);
  await tinhLaiMoc(env, vao);
}

/** Tinh lai thong tin tong hop cua luong tu cac thu: goc, cuoi, so thu, moc de xuat, moc duyet. */
async function tinhLaiMoc(env: Env, luongId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE luong SET
       msg_count = (SELECT COUNT(*) FROM thu WHERE luong_id = ?1),
       origin_at = (SELECT MIN(sent_at) FROM thu WHERE luong_id = ?1),
       origin_name = COALESCE((SELECT from_name FROM thu WHERE luong_id = ?1 ORDER BY sent_at LIMIT 1), ''),
       origin_email = COALESCE((SELECT from_email FROM thu WHERE luong_id = ?1 ORDER BY sent_at LIMIT 1), ''),
       subject = COALESCE((SELECT subject FROM thu WHERE luong_id = ?1 ORDER BY sent_at LIMIT 1), ''),
       last_at = (SELECT MAX(sent_at) FROM thu WHERE luong_id = ?1),
       last_from = COALESCE((SELECT from_email FROM thu WHERE luong_id = ?1 ORDER BY sent_at DESC LIMIT 1), ''),
       de_xuat_at = (SELECT MIN(sent_at) FROM thu WHERE luong_id = ?1 AND la_de_xuat = 1),
       de_xuat_from = COALESCE((SELECT from_email FROM thu WHERE luong_id = ?1 AND la_de_xuat = 1 ORDER BY sent_at LIMIT 1), ''),
       updated_at = ${NOW_SQL}
     WHERE id = ?1`,
  )
    .bind(luongId)
    .run();
  await env.DB.prepare(
    `UPDATE luong SET origin_domain = CASE WHEN instr(origin_email, '@') > 0
       THEN substr(origin_email, instr(origin_email, '@') + 1) ELSE '' END WHERE id = ?1`,
  )
    .bind(luongId)
    .run();
  // Moc duyet tu dong chi cap nhat khi nguoi dung chua xac nhan tay.
  await env.DB.prepare(
    `UPDATE luong SET
       duyet_at = d.sent_at, duyet_from = d.from_email, duyet_text = substr(d.body_new, 1, 500)
     FROM (SELECT sent_at, from_email, body_new FROM thu
           WHERE luong_id = ?1 AND la_duyet = 1
             AND sent_at >= COALESCE((SELECT de_xuat_at FROM luong WHERE id = ?1), '')
           ORDER BY sent_at LIMIT 1) AS d
     WHERE luong.id = ?1 AND luong.duyet_xac_nhan = 0`,
  )
    .bind(luongId)
    .run();
}

// ---------------------------------------------------------------- doc / sua

async function listLuong(env: Env, sp: URLSearchParams) {
  const where: string[] = [];
  const args: unknown[] = [];
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    args.push(`%${q}%`);
    const i = args.length;
    where.push(`(dvbh_case_id LIKE ?${i} OR ma_trong_mail LIKE ?${i} OR serial LIKE ?${i} OR subject LIKE ?${i}
      OR origin_email LIKE ?${i} OR ghi_chu LIKE ?${i}
      OR id IN (SELECT luong_id FROM thu WHERE body_new LIKE ?${i} OR from_email LIKE ?${i}))`);
  }
  const status = sp.get("match");
  if (status && (MATCH_STATUSES as readonly string[]).includes(status)) {
    args.push(status);
    where.push(`match_status = ?${args.length}`);
  }
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM luong ${whereSql}`).bind(...args).first<{ n: number }>();
  const rows = await env.DB.prepare(
    `SELECT id, dvbh_case_id, match_status, ma_trong_mail, serial, loai_yeu_cau, subject, origin_email, origin_at,
            last_at, last_from, msg_count, de_xuat_at, de_xuat_from, duyet_at, duyet_from, duyet_xac_nhan
     FROM luong ${whereSql} ORDER BY last_at DESC LIMIT 50 OFFSET ${(page - 1) * 50}`,
  )
    .bind(...args)
    .all();
  return { total: total?.n ?? 0, page, pageSize: 50, luong: rows.results };
}

async function getLuong(env: Env, id: number) {
  const l = await env.DB.prepare("SELECT * FROM luong WHERE id = ?").bind(id).first();
  if (!l) throw new HttpError(404, "Không có luồng này");
  const thu = await env.DB.prepare(
    `SELECT id, nguon, gmail_id, from_name, from_email, to_addr, cc_addr, subject, sent_at, body_new, attachments,
            link_method, la_de_xuat, la_duyet
     FROM thu WHERE luong_id = ? ORDER BY sent_at`,
  )
    .bind(id)
    .all();
  return { luong: l, thu: thu.results };
}

async function updateLuong(env: Env, id: number, input: unknown) {
  const b = (input ?? {}) as Record<string, unknown>;
  if (typeof b.ghi_chu === "string") {
    await env.DB.prepare("UPDATE luong SET ghi_chu = ? WHERE id = ?").bind(b.ghi_chu.slice(0, 5000), id).run();
  }
  // Xac nhan / sua moc duyet tay: { duyet_at: ISO | null }
  if ("duyet_at" in b) {
    const at = typeof b.duyet_at === "string" && b.duyet_at ? toIso(b.duyet_at) : null;
    await env.DB.prepare("UPDATE luong SET duyet_at = ?, duyet_xac_nhan = 1 WHERE id = ?").bind(at, id).run();
  }
  // Gan tay case DVBH: { dvbh_case_id: "1347322" }
  if (typeof b.dvbh_case_id === "string") {
    const ma = b.dvbh_case_id.trim().toUpperCase();
    if (!MA_CASE_RE.test(ma)) throw new HttpError(400, "Mã case không hợp lệ");
    await env.DB.prepare("UPDATE luong SET ma_trong_mail = ?, match_status = 'chua_gan', dvbh_case_id = NULL WHERE id = ?")
      .bind(ma, id)
      .run();
    return { ok: true, luongId: await ganDvbh(env, id) };
  }
  return { ok: true, luongId: id };
}

async function stats(env: Env) {
  const [byMatch, byLoai, moc, totals] = await env.DB.batch([
    env.DB.prepare("SELECT match_status, COUNT(*) AS n FROM luong GROUP BY match_status"),
    env.DB.prepare("SELECT loai_yeu_cau, COUNT(*) AS n FROM luong GROUP BY loai_yeu_cau ORDER BY n DESC"),
    env.DB.prepare(
      `SELECT COUNT(de_xuat_at) AS co_de_xuat, COUNT(duyet_at) AS co_duyet,
              AVG(CASE WHEN duyet_at IS NOT NULL AND de_xuat_at IS NOT NULL
                  THEN (julianday(duyet_at) - julianday(de_xuat_at)) * 24 END) AS tb_gio_de_xuat_den_duyet
       FROM luong`,
    ),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM luong) AS luong, (SELECT COUNT(*) FROM thu) AS thu,
              (SELECT COUNT(*) FROM thu WHERE nguon = 'trich_dan') AS thu_trich_dan,
              (SELECT COUNT(*) FROM bo_qua) AS bo_qua, (SELECT MAX(created_at) FROM thu) AS lan_nhan_cuoi`,
    ),
  ]);
  return { byMatch: byMatch.results, byLoai: byLoai.results, moc: moc.results[0], totals: totals.results[0] };
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
  return b64url(new Uint8Array(mac));
}

async function hash(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return b64url(new Uint8Array(d)).slice(0, 24);
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
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

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
