// Noi ca MOI (mo de doi may cho KH) voi ca GOC - CHI theo case_dvbh.id_khach_hang (chot nghiep vu, khong tra SDT).
// Chay trong luot dong bo 3h (baoCao.ts dongBoTranhChap). CHI DOC DVBH, query di theo index idx_case_id_khach_hang.
import type { Env } from "./index";

const CUA_SO_NGAY = 60; // ca moi phai duoc tiep nhan trong 60 ngay sau moc duyet

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

/**
 * Tim ca moi cho moi ho so DA DUYET doi (co duyet_at trong luong mail). Ket qua luu bang ca_moi.
 * Ho so da duoc nguoi dung xac nhan tay (trang_thai_gan = 'xac_nhan') chi lam moi thoi gian/tien do cua ca da chon.
 */
export async function timCaMoi(env: Env, now: string) {
  const goc = await env.DB.prepare(
    `SELECT l.dvbh_case_id AS case_id, l.duyet_at, l.de_xuat_json, m.trang_thai_gan, m.ca_moi_id
     FROM luong l LEFT JOIN ca_moi m ON m.case_goc = l.dvbh_case_id
     WHERE l.dvbh_case_id IS NOT NULL AND l.duyet_at IS NOT NULL`,
  ).all<{ case_id: string; duyet_at: string; de_xuat_json: string; trang_thai_gan: string | null; ca_moi_id: string | null }>();
  if (!goc.results.length) return { ho_so: 0, tu_dong: 0, can_xac_nhan: 0 };

  const ids = goc.results.map((g) => g.case_id);
  const gocDv = await env.DVBH_DB.prepare(
    `SELECT CAST(id AS TEXT) AS id, id_khach_hang, san_pham_bao_hanh, thoi_gian_cskh_tiep_nhan, thoi_gian_hoan_thanh, tien_do_hoan_thanh
     FROM case_dvbh WHERE id IN (SELECT value FROM json_each(?1))`,
  )
    .bind(JSON.stringify(ids))
    .all<CaseDv>();
  const gocMap = new Map(gocDv.results.map((c) => [c.id.toUpperCase(), c]));

  const khs = [...new Set(gocDv.results.map((c) => c.id_khach_hang).filter((x): x is string => !!x))];
  const minDuyet = goc.results.map((g) => g.duyet_at).sort()[0];
  const ungVienAll = khs.length
    ? await env.DVBH_DB.prepare(
        `SELECT CAST(id AS TEXT) AS id, id_khach_hang, san_pham_bao_hanh, thoi_gian_cskh_tiep_nhan, thoi_gian_hoan_thanh, tien_do_hoan_thanh
         FROM case_dvbh WHERE id_khach_hang IN (SELECT value FROM json_each(?1)) AND thoi_gian_cskh_tiep_nhan >= ?2`,
      )
        .bind(JSON.stringify(khs), isoToVn(minDuyet))
        .all<CaseDv>()
    : { results: [] as CaseDv[] };

  let tuDong = 0;
  let canXacNhan = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const g of goc.results) {
    const dv = gocMap.get(g.case_id);
    const kh = dv?.id_khach_hang ?? null;
    const tu = isoToVn(g.duyet_at);
    const den = isoToVn(new Date(Date.parse(g.duyet_at) + CUA_SO_NGAY * 86400_000).toISOString());
    const modelDeXuat = String((JSON.parse(g.de_xuat_json || "{}") as Record<string, string>)["Máy/Linh kiện đề xuất đổi"] ?? "");
    const uv: UngVien[] = kh
      ? ungVienAll.results
          .filter((c) => c.id_khach_hang === kh && c.id.toUpperCase() !== g.case_id && (c.thoi_gian_cskh_tiep_nhan ?? "") >= tu && (c.thoi_gian_cskh_tiep_nhan ?? "") <= den)
          .sort((a, b) => (a.thoi_gian_cskh_tiep_nhan ?? "").localeCompare(b.thoi_gian_cskh_tiep_nhan ?? ""))
          .map((c) => ({
            id: c.id.toUpperCase(),
            tn_at: vnToIso(c.thoi_gian_cskh_tiep_nhan),
            ht_at: vnToIso(c.thoi_gian_hoan_thanh),
            san_pham: c.san_pham_bao_hanh ?? "",
            tien_do: c.tien_do_hoan_thanh ?? "",
            khop_model: khopModel(c.san_pham_bao_hanh ?? "", dv?.san_pham_bao_hanh ?? "", modelDeXuat),
          }))
      : [];

    let trangThai: string;
    let chon: UngVien | undefined;
    if (g.trang_thai_gan === "xac_nhan") {
      trangThai = "xac_nhan";
      chon = uv.find((u) => u.id === g.ca_moi_id); // ngoai cua so -> giu ca_moi_id, chi khong lam moi thoi gian
    } else if (!kh) {
      trangThai = "khong_co_id_kh";
    } else {
      const manh = uv.filter((u) => u.khop_model);
      if (manh.length === 1) {
        trangThai = "tu_dong";
        chon = manh[0];
      } else if (manh.length > 1 || uv.length > 1) trangThai = "nhieu_ung_vien";
      else if (uv.length === 1) trangThai = "goi_y";
      else trangThai = "chua_co";
    }
    if (trangThai === "tu_dong") tuDong++;
    if (trangThai === "nhieu_ung_vien" || trangThai === "goi_y") canXacNhan++;

    stmts.push(
      env.DB.prepare(
        `INSERT INTO ca_moi (case_goc, id_khach_hang, ca_moi_id, trang_thai_gan, ung_vien_json, ca_moi_tn_at, ca_moi_ht_at,
           ca_moi_tien_do, ca_moi_san_pham, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(case_goc) DO UPDATE SET
           id_khach_hang = excluded.id_khach_hang,
           ca_moi_id = CASE WHEN ca_moi.trang_thai_gan = 'xac_nhan' THEN ca_moi.ca_moi_id ELSE excluded.ca_moi_id END,
           trang_thai_gan = excluded.trang_thai_gan,
           ung_vien_json = excluded.ung_vien_json,
           ca_moi_tn_at = CASE WHEN ca_moi.trang_thai_gan = 'xac_nhan' AND excluded.ca_moi_tn_at IS NULL THEN ca_moi.ca_moi_tn_at ELSE excluded.ca_moi_tn_at END,
           ca_moi_ht_at = CASE WHEN ca_moi.trang_thai_gan = 'xac_nhan' AND excluded.ca_moi_tn_at IS NULL THEN ca_moi.ca_moi_ht_at ELSE excluded.ca_moi_ht_at END,
           ca_moi_tien_do = CASE WHEN ca_moi.trang_thai_gan = 'xac_nhan' AND excluded.ca_moi_tn_at IS NULL THEN ca_moi.ca_moi_tien_do ELSE excluded.ca_moi_tien_do END,
           ca_moi_san_pham = CASE WHEN ca_moi.trang_thai_gan = 'xac_nhan' AND excluded.ca_moi_tn_at IS NULL THEN ca_moi.ca_moi_san_pham ELSE excluded.ca_moi_san_pham END,
           synced_at = excluded.synced_at`,
      ).bind(
        g.case_id,
        kh ?? "",
        chon?.id ?? (trangThai === "xac_nhan" ? g.ca_moi_id : null),
        trangThai,
        JSON.stringify(uv.slice(0, 15)),
        chon?.tn_at ?? null,
        chon?.ht_at ?? null,
        chon?.tien_do ?? "",
        chon?.san_pham ?? "",
        now,
      ),
    );
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { ho_so: goc.results.length, tu_dong: tuDong, can_xac_nhan: canXacNhan };
}

/**
 * Nguoi dung xac nhan ca moi cho 1 ca goc:
 *   - caMoiId = "<ma ca>": chon ca do (phai nam trong danh sach ung vien).
 *   - caMoiId = "": xac nhan KHONG co ca moi (vd goi y sai) - giu qua cac lan dong bo.
 *   - caMoiId = null: bo xac nhan, lan dong bo sau tu tim lai.
 */
export async function xacNhanCaMoi(env: Env, caseGoc: string, caMoiId: string | null) {
  const row = await env.DB.prepare("SELECT ung_vien_json FROM ca_moi WHERE case_goc = ?").bind(caseGoc).first<{ ung_vien_json: string }>();
  if (!row) return { ok: false, error: "Chưa có dữ liệu ca mới cho ca gốc này" };
  if (caMoiId === "") {
    await env.DB.prepare(
      `UPDATE ca_moi SET trang_thai_gan = 'xac_nhan', ca_moi_id = NULL, ca_moi_tn_at = NULL, ca_moi_ht_at = NULL,
         ca_moi_tien_do = '', ca_moi_san_pham = '', nguoi_xac_nhan = 'web' WHERE case_goc = ?`,
    )
      .bind(caseGoc)
      .run();
    return { ok: true };
  }
  if (caMoiId === null) {
    await env.DB.prepare(
      `UPDATE ca_moi SET trang_thai_gan = 'chua_co', ca_moi_id = NULL, ca_moi_tn_at = NULL, ca_moi_ht_at = NULL,
         ca_moi_tien_do = '', ca_moi_san_pham = '', nguoi_xac_nhan = '' WHERE case_goc = ?`,
    )
      .bind(caseGoc)
      .run();
    return { ok: true };
  }
  const uv = (JSON.parse(row.ung_vien_json) as UngVien[]).find((u) => u.id === caMoiId.toUpperCase());
  if (!uv) return { ok: false, error: "Ca này không nằm trong danh sách ứng viên" };
  await env.DB.prepare(
    `UPDATE ca_moi SET trang_thai_gan = 'xac_nhan', ca_moi_id = ?2, ca_moi_tn_at = ?3, ca_moi_ht_at = ?4,
       ca_moi_tien_do = ?5, ca_moi_san_pham = ?6, nguoi_xac_nhan = 'web' WHERE case_goc = ?1`,
  )
    .bind(caseGoc, uv.id, uv.tn_at, uv.ht_at, uv.tien_do, uv.san_pham)
    .run();
  return { ok: true };
}
