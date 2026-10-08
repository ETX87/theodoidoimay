// Bao cao vong doi doi tra = ghep 2 nguon theo ma case DVBH:
//   - Ho so "Tranh chấp, khiếu nại" cua DVBH (dong bo ve bang tc_doi_may): phat sinh yeu cau doi, CSKH xu ly, ket thuc.
//   - Luong mail (bang luong): Karofi tiep nhan, de xuat doi, TBP duyet, giao xu ly, len SO, len DO.
import type { Env } from "./index";

const PHAN_LOAI_DOI_MAY = ["KH đòi đổi máy", "Đổi trả"];
const DONG_HOAN_THANH = "Giam sat dong hoan thanh";
const DONG_THAT_BAI = "Giam sat dong that bai";
const KET_NGAY = 3; // ho so mo khong co hoat dong > 3 ngay = ket

/** "2026-09-28 17:08:40" (gio VN, cach DVBH luu) -> ISO UTC. */
function vnToIso(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(`${s.trim().replace(" ", "T")}+07:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

interface TcRow {
  id: string;
  case_id: string;
  phan_loai_tranh_chap: string;
  muc_do: string;
  nguoi_tao: string;
  ngay_tao: string;
  hang: string | null;
  khu_vuc: string | null;
  tinh: string | null;
  ky_thuat_vien: string | null;
  san_pham_bao_hanh: string | null;
}

interface LogRow {
  tien_trinh_id: string;
  ngay_xu_ly: string;
  trang_thai_xu_ly: string;
  ket_qua_xu_ly: string | null;
  ghi_chu: string | null;
  nguoi_xu_ly: string;
}

/**
 * Dong bo ho so tranh chap doi may tu DVBH (CHI DOC). Toan bo 2 bang nguon chi vai nghin dong -> doc lai het
 * moi lan (3 gio/lan ~ 28k rows_read/ngay, < 1% ngan sach D1 cua DVBH), don gian va tu sua sai.
 */
export async function dongBoTranhChap(env: Env) {
  const caseCoMail = await env.DB.prepare("SELECT dvbh_case_id AS id FROM luong WHERE dvbh_case_id IS NOT NULL").all<{ id: string }>();
  const tt = await env.DVBH_DB.prepare(
    `SELECT t.id, CAST(t.case_id AS TEXT) AS case_id, t.phan_loai_tranh_chap, t.muc_do, t.nguoi_tao, t.ngay_tao,
            c.hang, c.khu_vuc, c.tinh, c.ky_thuat_vien, c.san_pham_bao_hanh
     FROM tranh_chap_tien_trinh t LEFT JOIN case_dvbh c ON c.id = t.case_id
     WHERE t.phan_loai_tranh_chap IN (SELECT value FROM json_each(?1))
        OR t.case_id IN (SELECT value FROM json_each(?2))`,
  )
    .bind(JSON.stringify(PHAN_LOAI_DOI_MAY), JSON.stringify(caseCoMail.results.map((r) => r.id)))
    .all<TcRow>();
  const ids = tt.results.map((r) => r.id);
  const logs = ids.length
    ? await env.DVBH_DB.prepare(
        `SELECT tien_trinh_id, ngay_xu_ly, trang_thai_xu_ly, ket_qua_xu_ly, ghi_chu, nguoi_xu_ly
         FROM tranh_chap_log WHERE tien_trinh_id IN (SELECT value FROM json_each(?1)) ORDER BY ngay_xu_ly, id`,
      )
        .bind(JSON.stringify(ids))
        .all<LogRow>()
    : { results: [] as LogRow[] };

  const byTt = new Map<string, LogRow[]>();
  for (const l of logs.results) byTt.set(l.tien_trinh_id, [...(byTt.get(l.tien_trinh_id) ?? []), l]);

  const now = new Date().toISOString();
  const stmts = tt.results.map((t) => {
    const ls = byTt.get(t.id) ?? [];
    const dong = ls.find((l) => l.trang_thai_xu_ly === DONG_HOAN_THANH || l.trang_thai_xu_ly === DONG_THAT_BAI);
    const cuoi = ls[ls.length - 1];
    return env.DB.prepare(
      `INSERT OR REPLACE INTO tc_doi_may (tien_trinh_id, case_id, phan_loai, muc_do, nguoi_tao, yc_at, cskh_at, ket_thuc_at,
         ket_thuc_loai, trang_thai, ket_qua, cap_nhat_at, logs_json, hang, khu_vuc, tinh, ky_thuat_vien, san_pham, synced_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
    ).bind(
      t.id,
      String(t.case_id).toUpperCase(),
      t.phan_loai_tranh_chap,
      t.muc_do ?? "",
      t.nguoi_tao ?? "",
      vnToIso(t.ngay_tao),
      vnToIso(ls.find((l) => l.trang_thai_xu_ly.startsWith("CSKH"))?.ngay_xu_ly ?? null),
      vnToIso(dong?.ngay_xu_ly ?? null),
      dong ? (dong.trang_thai_xu_ly === DONG_HOAN_THANH ? "hoan_thanh" : "that_bai") : "",
      cuoi?.trang_thai_xu_ly ?? "",
      [...ls].reverse().find((l) => l.ket_qua_xu_ly)?.ket_qua_xu_ly ?? "",
      vnToIso(cuoi?.ngay_xu_ly ?? t.ngay_tao),
      JSON.stringify(ls.map((l) => ({ at: vnToIso(l.ngay_xu_ly), trang_thai: l.trang_thai_xu_ly, ket_qua: l.ket_qua_xu_ly, ghi_chu: l.ghi_chu, nguoi: l.nguoi_xu_ly }))),
      t.hang ?? "",
      t.khu_vuc ?? "",
      t.tinh ?? "",
      t.ky_thuat_vien ?? "",
      t.san_pham_bao_hanh ?? "",
      now,
    );
  });
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  // Ho so doi phan loai khoi nhom doi may (va khong con case co mail) -> xoa ban sao.
  await env.DB.prepare("DELETE FROM tc_doi_may WHERE synced_at != ?").bind(now).run();
  // Lam moi anh chup thong tin case DVBH cua cac luong mail (hang/khu vuc/KTV doi theo import).
  const ids2 = caseCoMail.results.map((r) => r.id);
  if (ids2.length) {
    const cs = await env.DVBH_DB.prepare(
      `SELECT CAST(id AS TEXT) AS id, khach_hang, khu_vuc, seri_san_pham, san_pham_bao_hanh, hang, tinh, ky_thuat_vien,
              tien_do_hoan_thanh, thoi_gian_cskh_tiep_nhan, thoi_gian_hoan_thanh, link_crm
       FROM case_dvbh WHERE id IN (SELECT value FROM json_each(?1))`,
    )
      .bind(JSON.stringify(ids2))
      .all<Record<string, unknown>>();
    const up = cs.results.map((c) =>
      env.DB.prepare(`UPDATE luong SET dvbh_json = ?2, dvbh_checked_at = ?3 WHERE dvbh_case_id = ?1`).bind(String(c.id).toUpperCase(), JSON.stringify(c), now),
    );
    for (let i = 0; i < up.length; i += 50) await env.DB.batch(up.slice(i, i + 50));
  }
  const ketQua = { ho_so: tt.results.length, log: logs.results.length, luong_lam_moi: ids2.length };
  await env.DB.prepare("INSERT OR REPLACE INTO dong_bo (ten, lan_cuoi, ket_qua) VALUES ('tranh_chap', ?, ?)")
    .bind(now, JSON.stringify(ketQua))
    .run();
  return { ok: true, ...ketQua };
}

// ---------------------------------------------------------------- bao cao

interface TcDb {
  tien_trinh_id: string;
  case_id: string;
  phan_loai: string;
  muc_do: string;
  yc_at: string | null;
  cskh_at: string | null;
  ket_thuc_at: string | null;
  ket_thuc_loai: string;
  trang_thai: string;
  ket_qua: string;
  cap_nhat_at: string | null;
  hang: string;
  khu_vuc: string;
  tinh: string;
  ky_thuat_vien: string;
  san_pham: string;
}

interface LuongDb {
  id: number;
  dvbh_case_id: string | null;
  match_status: string;
  trang_thai: string;
  loai_yeu_cau: string;
  subject: string;
  origin_email: string;
  origin_at: string | null;
  last_at: string | null;
  tiep_nhan_at: string | null;
  de_xuat_at: string | null;
  duyet_at: string | null;
  giao_xu_ly_at: string | null;
  len_so_at: string | null;
  len_do_at: string | null;
  dvbh_json: string;
}

export const TRANG_THAI_HO_SO = [
  "moi_phat_sinh", "cskh_xu_ly", "cho_duyet", "da_duyet", "giao_xu_ly", "da_len_so", "da_len_do",
  "dong_hoan_thanh", "dong_that_bai",
] as const;

const BUOC: [string, string, string][] = [
  // [khoa, tu moc, den moc]
  ["yc_den_de_xuat", "yc_at", "de_xuat_at"],
  ["de_xuat_den_duyet", "de_xuat_at", "duyet_at"],
  ["duyet_den_giao", "duyet_at", "giao_xu_ly_at"],
  ["giao_den_so", "giao_xu_ly_at", "len_so_at"],
  ["so_den_do", "len_so_at", "len_do_at"],
  ["yc_den_ket_thuc", "yc_at", "ket_thuc_at"],
];

export async function baoCao(env: Env, sp: URLSearchParams) {
  const theoDoiTu = env.THEO_DOI_TU || "2026-10-08";
  const [tcRes, luongRes, dongBo] = await env.DB.batch([
    env.DB.prepare(`SELECT tien_trinh_id, case_id, phan_loai, muc_do, yc_at, cskh_at, ket_thuc_at, ket_thuc_loai, trang_thai, ket_qua,
                           cap_nhat_at, hang, khu_vuc, tinh, ky_thuat_vien, san_pham FROM tc_doi_may ORDER BY yc_at`),
    env.DB.prepare(`SELECT id, dvbh_case_id, match_status, trang_thai, loai_yeu_cau, subject, origin_email, origin_at, last_at,
                           tiep_nhan_at, de_xuat_at, duyet_at, giao_xu_ly_at, len_so_at, len_do_at, dvbh_json FROM luong`),
    env.DB.prepare("SELECT lan_cuoi, ket_qua FROM dong_bo WHERE ten = 'tranh_chap'"),
  ]);
  const tcs = tcRes.results as unknown as TcDb[];
  const luongs = luongRes.results as unknown as LuongDb[];

  // 1 case co the co nhieu ho so tranh chap -> lay ho so doi may som nhat lam chinh.
  const tcByCase = new Map<string, TcDb>();
  for (const t of tcs) if (!tcByCase.has(t.case_id)) tcByCase.set(t.case_id, t);
  const luongByCase = new Map<string, LuongDb>();
  for (const l of luongs) if (l.dvbh_case_id) luongByCase.set(l.dvbh_case_id, l);

  const caseIds = new Set([...tcByCase.keys(), ...luongByCase.keys()]);
  const now = Date.now();
  const hoSo = [...caseIds].map((caseId) => {
    const t = tcByCase.get(caseId);
    const l = luongByCase.get(caseId);
    const dv = l ? (JSON.parse(l.dvbh_json || "{}") as Record<string, string | null>) : {};
    const moc = {
      yc_at: t?.yc_at ?? null,
      cskh_at: t?.cskh_at ?? null,
      mail_goc_at: l?.origin_at ?? null,
      tiep_nhan_at: l?.tiep_nhan_at ?? null,
      de_xuat_at: l?.de_xuat_at ?? null,
      duyet_at: l?.duyet_at ?? null,
      giao_xu_ly_at: l?.giao_xu_ly_at ?? null,
      len_so_at: l?.len_so_at ?? null,
      len_do_at: l?.len_do_at ?? null,
      ket_thuc_at: t?.ket_thuc_at ?? null,
    };
    const phatSinh = [moc.yc_at, moc.mail_goc_at].filter(Boolean).sort()[0] ?? null;
    const hoatDongCuoi = [t?.cap_nhat_at, l?.last_at, ...Object.values(moc)].filter(Boolean).sort().pop() ?? null;

    let trangThai: (typeof TRANG_THAI_HO_SO)[number];
    if (t?.ket_thuc_loai === "that_bai") trangThai = "dong_that_bai";
    else if (moc.len_do_at) trangThai = "da_len_do";
    else if (moc.len_so_at) trangThai = "da_len_so";
    else if (moc.giao_xu_ly_at) trangThai = "giao_xu_ly";
    else if (moc.duyet_at) trangThai = "da_duyet";
    else if (moc.de_xuat_at) trangThai = "cho_duyet";
    else if (t?.ket_thuc_loai === "hoan_thanh") trangThai = "dong_hoan_thanh";
    else if (moc.cskh_at) trangThai = "cskh_xu_ly";
    else trangThai = "moi_phat_sinh";

    const dangMo = !["da_len_do", "dong_hoan_thanh", "dong_that_bai"].includes(trangThai) && !t?.ket_thuc_at;
    // Chi tinh cho ho so dang mo (ho so da dong/da len DO khong con "khong hoat dong").
    const ngayKhongHoatDong = dangMo && hoatDongCuoi ? Math.floor((now - Date.parse(hoatDongCuoi)) / 86400_000) : null;

    const doiSoat: string[] = [];
    if (t && !l && !t.ket_thuc_at && (t.yc_at ?? "") >= theoDoiTu) doiSoat.push("tc_chua_mail");
    if (l?.de_xuat_at && !t) doiSoat.push("mail_chua_tc");
    if (t && moc.duyet_at && !t.ket_thuc_at && (t.cap_nhat_at ?? "") < moc.duyet_at) doiSoat.push("duyet_tc_chua_cap_nhat");
    if (dangMo && ngayKhongHoatDong !== null && ngayKhongHoatDong > KET_NGAY) doiSoat.push("ket");

    return {
      case_id: caseId,
      nguon: t && l ? "ca_hai" : t ? "tranh_chap" : "mail",
      tien_trinh_id: t?.tien_trinh_id ?? null,
      luong_id: l?.id ?? null,
      phan_loai: t?.phan_loai ?? "",
      loai_yeu_cau: l?.loai_yeu_cau ?? "",
      hang: t?.hang || dv.hang || "",
      khu_vuc: t?.khu_vuc || dv.khu_vuc || "",
      tinh: t?.tinh || dv.tinh || "",
      ky_thuat_vien: t?.ky_thuat_vien || dv.ky_thuat_vien || "",
      san_pham: t?.san_pham || dv.san_pham_bao_hanh || "",
      tc_trang_thai: t?.trang_thai ?? "",
      tc_ket_qua: t?.ket_qua ?? "",
      trang_thai: trangThai,
      phat_sinh_at: phatSinh,
      hoat_dong_cuoi_at: hoatDongCuoi,
      ngay_khong_hoat_dong: ngayKhongHoatDong,
      ...moc,
      doi_soat: doiSoat,
    };
  });

  // Loc
  const tu = sp.get("tu") ?? "";
  const den = sp.get("den") ?? "";
  const vn = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10) : "");
  const loc = hoSo.filter((h) => {
    const d = vn(h.phat_sinh_at);
    if (tu && d < tu) return false;
    if (den && d > den) return false;
    for (const k of ["hang", "khu_vuc", "trang_thai", "nguon"] as const) {
      const v = sp.get(k);
      if (v && h[k] !== v) return false;
    }
    const ds = sp.get("doi_soat");
    if (ds && !h.doi_soat.includes(ds)) return false;
    return true;
  });
  loc.sort((a, b) => (b.phat_sinh_at ?? "").localeCompare(a.phat_sinh_at ?? ""));

  // Thoi gian trung binh tung buoc (gio) tren tap da loc
  const thoiGian: Record<string, { tb_gio: number | null; n: number }> = {};
  for (const [k, a, b] of BUOC) {
    const ds = loc
      .map((h) => {
        const x = (h as Record<string, unknown>)[a] as string | null;
        const y = (h as Record<string, unknown>)[b] as string | null;
        return x && y && y >= x ? (Date.parse(y) - Date.parse(x)) / 3600_000 : null;
      })
      .filter((v): v is number => v !== null);
    thoiGian[k] = { tb_gio: ds.length ? Math.round((ds.reduce((s, v) => s + v, 0) / ds.length) * 10) / 10 : null, n: ds.length };
  }

  const dem = (f: (h: (typeof hoSo)[number]) => boolean) => loc.filter(f).length;
  const tatCaGiaTri = (k: "hang" | "khu_vuc") => [...new Set(hoSo.map((h) => h[k]).filter(Boolean))].sort();

  return {
    theo_doi_tu: theoDoiTu,
    dong_bo: dongBo.results[0] ?? null,
    tong: loc.length,
    theo_trang_thai: Object.fromEntries(TRANG_THAI_HO_SO.map((s) => [s, dem((h) => h.trang_thai === s)])),
    theo_nguon: { ca_hai: dem((h) => h.nguon === "ca_hai"), tranh_chap: dem((h) => h.nguon === "tranh_chap"), mail: dem((h) => h.nguon === "mail") },
    doi_soat: {
      tc_chua_mail: dem((h) => h.doi_soat.includes("tc_chua_mail")),
      mail_chua_tc: dem((h) => h.doi_soat.includes("mail_chua_tc")),
      duyet_tc_chua_cap_nhat: dem((h) => h.doi_soat.includes("duyet_tc_chua_cap_nhat")),
      ket: dem((h) => h.doi_soat.includes("ket")),
      luong_chua_gan: luongs.filter((l) => !l.dvbh_case_id).length,
    },
    thoi_gian: thoiGian,
    lua_chon: { hang: tatCaGiaTri("hang"), khu_vuc: tatCaGiaTri("khu_vuc") },
    ho_so: loc,
    luong_chua_gan: luongs
      .filter((l) => !l.dvbh_case_id)
      .map((l) => ({ id: l.id, match_status: l.match_status, subject: l.subject, origin_email: l.origin_email, last_at: l.last_at })),
  };
}

export async function chiTietHoSo(env: Env, caseId: string) {
  const [tc, luong] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM tc_doi_may WHERE case_id = ? ORDER BY yc_at").bind(caseId),
    env.DB.prepare("SELECT id FROM luong WHERE dvbh_case_id = ?").bind(caseId),
  ]);
  const luongId = (luong.results[0] as { id?: number } | undefined)?.id;
  const thu = luongId
    ? await env.DB.prepare(
        `SELECT nguon, gmail_id, from_name, from_email, subject, sent_at, substr(body_new, 1, 1500) AS body_new,
                la_de_xuat, la_duyet, moc FROM thu WHERE luong_id = ? ORDER BY sent_at`,
      )
        .bind(luongId)
        .all()
    : { results: [] };
  return {
    tranh_chap: (tc.results as Record<string, unknown>[]).map((t) => ({ ...t, logs: JSON.parse(String(t.logs_json || "[]")), logs_json: undefined })),
    thu: thu.results,
  };
}
