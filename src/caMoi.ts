// Noi ca MOI (mo de doi may cho KH) voi ca GOC - CHI theo case_dvbh.id_khach_hang (chot nghiep vu, khong tra SDT).
// Chay trong luot dong bo 3h (baoCao.ts dongBoTranhChap). CHI DOC DVBH, query di theo index idx_case_id_khach_hang.
//
// Quy tac (chot 2026-10-09):
//   - Chi TIM trong 30 ngay sau moc duyet; qua 30 ngay khong tim nua (luong tu ket thuc - doiTra.ts tuKetThucLuong).
//   - Ung vien = ca cung ID khach hang, tiep nhan trong cua so, VA khop danh muc "Theo dõi đổi trả" trong Cai dat DVBH:
//     loai_yeu_cau thuoc settings_loai_yeu_cau_doi_tra + luu_y_loi_linh_kien thuoc settings_luu_y_loi_linh_kien_doi_tra
//     (bat_tat = 1, doc truc tiep -> sua Cai dat la ap dung ngay).
//   - Dung 1 ung vien -> tu gan. Nhieu ung vien -> tu gan neu dung 1 ca khop model, con lai cho nguoi dung chon.
//   - Da co ca moi (tu gan hoac gan tay) -> NGUNG tim, chi doc lai tien do cua dung ca do (1 query theo id).
import type { Env } from "./index";
import { ghiNhatKy, HE_THONG } from "./doiTra";

export const CUA_SO_NGAY = 30;

interface CaseDv {
  id: string;
  id_khach_hang: string | null;
  san_pham_bao_hanh: string | null;
  thoi_gian_cskh_tiep_nhan: string | null;
  thoi_gian_hoan_thanh: string | null;
  tien_do_hoan_thanh: string | null;
}

export interface UngVien {
  id: string;
  tn_at: string | null;
  ht_at: string | null;
  san_pham: string;
  tien_do: string;
  khop_model: boolean;
}

const COLS = "CAST(id AS TEXT) AS id, id_khach_hang, san_pham_bao_hanh, thoi_gian_cskh_tiep_nhan, thoi_gian_hoan_thanh, tien_do_hoan_thanh";

/** "2026-09-28 17:08:40" (gio VN) -> ISO UTC. */
function vnToIso(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(`${s.trim().replace(" ", "T")}+07:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** ISO UTC -> "YYYY-MM-DD HH:MM:SS" gio VN (dinh dang DVBH luu) de so sanh chuoi. */
function isoToVn(iso: string): string {
  return new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
}

const chuanSp = (s: string | null) => (s ?? "").replace(/^\[[^\]]*\]\s*/, "").trim().toLowerCase();

/** Ma model co chu so trong 1 chuoi: "KAE-S86", "LRC-6218G", "S-100", "KAD-M29". */
function maModel(s: string): string[] {
  return [...s.toUpperCase().matchAll(/[A-Z]{1,5}-?[A-Z]?\d{2,5}[A-Z]?/g)].map((m) => m[0].replace(/-/g, ""));
}

function khopModel(spUngVien: string, spGoc: string, modelDeXuat: string): boolean {
  const sp = chuanSp(spUngVien);
  if (sp && sp === chuanSp(spGoc)) return true;
  const muc = new Set([...maModel(modelDeXuat), ...maModel(spGoc)]);
  return maModel(spUngVien).some((m) => muc.has(m));
}

const toUngVien = (c: CaseDv, khop: boolean): UngVien => ({
  id: c.id.toUpperCase(),
  tn_at: vnToIso(c.thoi_gian_cskh_tiep_nhan),
  ht_at: vnToIso(c.thoi_gian_hoan_thanh),
  san_pham: c.san_pham_bao_hanh ?? "",
  tien_do: c.tien_do_hoan_thanh ?? "",
  khop_model: khop,
});

/**
 * Luong dang mo + da duyet: (a) chua co ca moi va con trong 30 ngay sau duyet -> tim ung vien; (b) da co ca moi -> doc lai
 * tien do ca do. Luong da ket thuc / qua cua so ma chua co ca moi -> khong truy van gi.
 */
export async function timCaMoi(env: Env, now: string) {
  const tuNgay = new Date(Date.parse(now) - CUA_SO_NGAY * 86400_000).toISOString();
  const goc = await env.DB.prepare(
    `SELECT l.dvbh_case_id AS case_id, l.duyet_at, l.de_xuat_json, m.trang_thai_gan, m.ca_moi_id
     FROM luong l LEFT JOIN ca_moi m ON m.case_goc = l.dvbh_case_id
     WHERE l.dvbh_case_id IS NOT NULL AND l.ket_thuc_at IS NULL
       AND (m.ca_moi_id IS NOT NULL
            OR (l.duyet_at >= ?1 AND COALESCE(m.trang_thai_gan, '') != 'xac_nhan'))`, // xac_nhan + NULL = "khong co ca moi"
  )
    .bind(tuNgay)
    .all<{ case_id: string; duyet_at: string | null; de_xuat_json: string; trang_thai_gan: string | null; ca_moi_id: string | null }>();
  if (!goc.results.length) return { ho_so: 0, tim: 0, tu_dong: 0, can_xac_nhan: 0 };

  const daCo = goc.results.filter((g) => g.ca_moi_id);
  const canTim = goc.results.filter((g) => !g.ca_moi_id && g.duyet_at);

  // (b) Lam moi tien do cac ca moi da gan.
  const daCoDv = daCo.length
    ? await env.DVBH_DB.prepare(`SELECT ${COLS} FROM case_dvbh WHERE id IN (SELECT value FROM json_each(?1))`)
        .bind(JSON.stringify(daCo.map((g) => g.ca_moi_id)))
        .all<CaseDv>()
    : { results: [] as CaseDv[] };
  const daCoMap = new Map(daCoDv.results.map((c) => [c.id.toUpperCase(), c]));

  // (a) Tim ung vien: thong tin ca goc + ca cung ID KH khop danh muc doi tra, tiep nhan tu moc duyet som nhat.
  const gocDv = canTim.length
    ? await env.DVBH_DB.prepare(`SELECT ${COLS} FROM case_dvbh WHERE id IN (SELECT value FROM json_each(?1))`)
        .bind(JSON.stringify(canTim.map((g) => g.case_id)))
        .all<CaseDv>()
    : { results: [] as CaseDv[] };
  const gocMap = new Map(gocDv.results.map((c) => [c.id.toUpperCase(), c]));
  const khs = [...new Set(gocDv.results.map((c) => c.id_khach_hang).filter((x): x is string => !!x))];
  const minDuyet = canTim.map((g) => g.duyet_at!).sort()[0];
  const ungVienAll = khs.length
    ? await env.DVBH_DB.prepare(
        `SELECT ${COLS} FROM case_dvbh
         WHERE id_khach_hang IN (SELECT value FROM json_each(?1)) AND thoi_gian_cskh_tiep_nhan >= ?2
           AND loai_yeu_cau IN (SELECT loai_yeu_cau FROM settings_loai_yeu_cau_doi_tra WHERE bat_tat = 1)
           AND luu_y_loi_linh_kien IN (SELECT luu_y_loi_linh_kien FROM settings_luu_y_loi_linh_kien_doi_tra WHERE bat_tat = 1)`,
      )
        .bind(JSON.stringify(khs), isoToVn(minDuyet))
        .all<CaseDv>()
    : { results: [] as CaseDv[] };

  let tuDong = 0;
  let canXacNhan = 0;
  const stmts: D1PreparedStatement[] = [];
  const upsert = (caseGoc: string, kh: string, id: string | null, gan: string, uvJson: string | null, uv: UngVien | undefined) =>
    env.DB.prepare(
      `INSERT INTO ca_moi (case_goc, id_khach_hang, ca_moi_id, trang_thai_gan, ung_vien_json, ca_moi_tn_at, ca_moi_ht_at,
         ca_moi_tien_do, ca_moi_san_pham, synced_at)
       VALUES (?1, ?2, ?3, ?4, COALESCE(?5, '[]'), ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(case_goc) DO UPDATE SET
         id_khach_hang = CASE WHEN excluded.id_khach_hang != '' THEN excluded.id_khach_hang ELSE ca_moi.id_khach_hang END,
         ca_moi_id = excluded.ca_moi_id, trang_thai_gan = excluded.trang_thai_gan,
         ung_vien_json = COALESCE(?5, ca_moi.ung_vien_json),
         ca_moi_tn_at = excluded.ca_moi_tn_at, ca_moi_ht_at = excluded.ca_moi_ht_at,
         ca_moi_tien_do = excluded.ca_moi_tien_do, ca_moi_san_pham = excluded.ca_moi_san_pham, synced_at = excluded.synced_at`,
    ).bind(caseGoc, kh, id, gan, uvJson, uv?.tn_at ?? null, uv?.ht_at ?? null, uv?.tien_do ?? "", uv?.san_pham ?? "", now);

  for (const g of daCo) {
    const c = daCoMap.get(g.ca_moi_id!);
    if (c) stmts.push(upsert(g.case_id, "", g.ca_moi_id, g.trang_thai_gan ?? "xac_nhan", null, toUngVien(c, false)));
  }

  for (const g of canTim) {
    const dv = gocMap.get(g.case_id);
    const kh = dv?.id_khach_hang ?? "";
    if (!kh) {
      stmts.push(upsert(g.case_id, "", null, "khong_co_id_kh", "[]", undefined));
      continue;
    }
    const tu = isoToVn(g.duyet_at!);
    const den = isoToVn(new Date(Date.parse(g.duyet_at!) + CUA_SO_NGAY * 86400_000).toISOString());
    const modelDeXuat = String((JSON.parse(g.de_xuat_json || "{}") as Record<string, string>)["Máy/Linh kiện đề xuất đổi"] ?? "");
    const uv = ungVienAll.results
      .filter((c) => c.id_khach_hang === kh && c.id.toUpperCase() !== g.case_id && (c.thoi_gian_cskh_tiep_nhan ?? "") >= tu && (c.thoi_gian_cskh_tiep_nhan ?? "") <= den)
      .sort((a, b) => (a.thoi_gian_cskh_tiep_nhan ?? "").localeCompare(b.thoi_gian_cskh_tiep_nhan ?? ""))
      .map((c) => toUngVien(c, khopModel(c.san_pham_bao_hanh ?? "", dv?.san_pham_bao_hanh ?? "", modelDeXuat)));
    const manh = uv.filter((u) => u.khop_model);
    const chon = uv.length === 1 ? uv[0] : manh.length === 1 ? manh[0] : undefined;
    const gan = chon ? "tu_dong" : uv.length ? "nhieu_ung_vien" : "chua_co";
    if (chon) {
      tuDong++;
      stmts.push(ghiNhatKy(env, g.case_id, "gan_ca_moi", { nguoi: HE_THONG }, `Tự động: ca đổi ${chon.id} (cùng ID khách hàng, khớp danh mục đổi trả${chon.khop_model ? ", khớp model" : ""})`));
    }
    if (gan === "nhieu_ung_vien") canXacNhan++;
    stmts.push(upsert(g.case_id, kh, chon?.id ?? null, gan, JSON.stringify(uv.slice(0, 15)), chon));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { ho_so: goc.results.length, tim: canTim.length, tu_dong: tuDong, can_xac_nhan: canXacNhan };
}
