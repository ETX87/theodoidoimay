// Thao tac tren luong doi tra tu DVBH (API doi tac) + nhat ky ai lam gi.
//   - Ket thuc / mo lai luong: luong da ket thuc khong con truy van DVBH (dong bo 3h, tim ca moi, gan lai ban dem).
//   - Nhap ma ca moi (ca doi may cho KH) thu cong khi he thong khong tu tim duoc: ma bat ky co tren DVBH,
//     "" = xac nhan khong co, null = bo xac nhan.
// Moi thao tac ghi bang nhat_ky (nguoi = 'Hệ thống' khi tu dong).
import type { Env } from "./index";
import type { UngVien } from "./caMoi";

export const HE_THONG = "Hệ thống";

export interface NguoiThaoTac {
  nguoi: string;
  email?: string;
}

export function ghiNhatKy(env: Env, caseId: string, hanhDong: string, ai: NguoiThaoTac, chiTiet = "") {
  return env.DB.prepare("INSERT INTO nhat_ky (case_id, hanh_dong, nguoi, nguoi_email, chi_tiet) VALUES (?1, ?2, ?3, ?4, ?5)").bind(
    caseId,
    hanhDong,
    ai.nguoi || HE_THONG,
    ai.email ?? "",
    chiTiet.slice(0, 500),
  );
}

export async function nhatKyCase(env: Env, caseId: string) {
  const r = await env.DB.prepare("SELECT hanh_dong, nguoi, nguoi_email, chi_tiet, at FROM nhat_ky WHERE case_id = ? ORDER BY at, id")
    .bind(caseId)
    .all<{ hanh_dong: string; nguoi: string; nguoi_email: string; chi_tiet: string; at: string }>();
  return r.results;
}

/** "2026-09-28 17:08:40" (gio VN, dinh dang DVBH) -> ISO UTC. */
function vnToIso(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(`${s.trim().replace(" ", "T")}+07:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

interface CaseNgan {
  id: string;
  san_pham_bao_hanh: string | null;
  thoi_gian_cskh_tiep_nhan: string | null;
  thoi_gian_hoan_thanh: string | null;
  tien_do_hoan_thanh: string | null;
}

async function caseDvbh(env: Env, id: string): Promise<CaseNgan | null> {
  return env.DVBH_DB.prepare(
    `SELECT CAST(id AS TEXT) AS id, san_pham_bao_hanh, thoi_gian_cskh_tiep_nhan, thoi_gian_hoan_thanh, tien_do_hoan_thanh
     FROM case_dvbh WHERE id = ?1 OR id = lower(?1) LIMIT 1`,
  )
    .bind(id)
    .first<CaseNgan>();
}

type KetQua = { ok: true } | { ok: false; error: string; status?: number };

export async function ketThucLuong(env: Env, caseId: string, ai: NguoiThaoTac, ghiChu: string): Promise<KetQua> {
  const r = await env.DB.prepare(
    `UPDATE luong SET ket_thuc_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ket_thuc_boi = ?2, ket_thuc_ghi_chu = ?3
     WHERE dvbh_case_id = ?1 AND ket_thuc_at IS NULL`,
  )
    .bind(caseId, ai.nguoi, ghiChu.slice(0, 500))
    .run();
  if (!r.meta.changes) return { ok: false, error: "Không có luồng đổi trả đang mở cho ca này", status: 409 };
  await ghiNhatKy(env, caseId, "ket_thuc", ai, ghiChu).run();
  return { ok: true };
}

export async function moLaiLuong(env: Env, caseId: string, ai: NguoiThaoTac, ghiChu: string): Promise<KetQua> {
  const r = await env.DB.prepare(
    "UPDATE luong SET ket_thuc_at = NULL, ket_thuc_boi = '', ket_thuc_ghi_chu = '' WHERE dvbh_case_id = ?1 AND ket_thuc_at IS NOT NULL",
  )
    .bind(caseId)
    .run();
  if (!r.meta.changes) return { ok: false, error: "Luồng đổi trả của ca này chưa kết thúc", status: 409 };
  await ghiNhatKy(env, caseId, "mo_lai", ai, ghiChu).run();
  return { ok: true };
}

/**
 * Gan ca moi (ca mo de doi may cho KH) cho ca goc.
 *   caMoiId = "<ma>": ma bat ky co tren DVBH (khong bat buoc nam trong danh sach ung vien).
 *   caMoiId = "": xac nhan KHONG co ca moi.  caMoiId = null: bo xac nhan (lan dong bo sau tu tim lai).
 */
export async function ganCaMoi(env: Env, caseGoc: string, caMoiId: string | null, ai: NguoiThaoTac): Promise<KetQua> {
  const luong = await env.DB.prepare("SELECT id FROM luong WHERE dvbh_case_id = ?").bind(caseGoc).first();
  const row = await env.DB.prepare("SELECT ung_vien_json, ca_moi_id FROM ca_moi WHERE case_goc = ?")
    .bind(caseGoc)
    .first<{ ung_vien_json: string; ca_moi_id: string | null }>();
  if (!luong && !row) return { ok: false, error: "Ca gốc chưa có trong luồng đổi trả", status: 404 };
  const now = new Date().toISOString();
  const upsert = (id: string | null, gan: string, uv: Partial<UngVien>) =>
    env.DB.prepare(
      `INSERT INTO ca_moi (case_goc, ca_moi_id, trang_thai_gan, ca_moi_tn_at, ca_moi_ht_at, ca_moi_tien_do, ca_moi_san_pham, nguoi_xac_nhan, synced_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(case_goc) DO UPDATE SET ca_moi_id = excluded.ca_moi_id, trang_thai_gan = excluded.trang_thai_gan,
         ca_moi_tn_at = excluded.ca_moi_tn_at, ca_moi_ht_at = excluded.ca_moi_ht_at, ca_moi_tien_do = excluded.ca_moi_tien_do,
         ca_moi_san_pham = excluded.ca_moi_san_pham, nguoi_xac_nhan = excluded.nguoi_xac_nhan`,
    ).bind(caseGoc, id, gan, uv.tn_at ?? null, uv.ht_at ?? null, uv.tien_do ?? "", uv.san_pham ?? "", gan === "xac_nhan" ? ai.nguoi : "", now);

  if (caMoiId === null) {
    await env.DB.batch([upsert(null, "chua_co", {}), ghiNhatKy(env, caseGoc, "bo_ca_moi", ai, row?.ca_moi_id ? `Bỏ ca mới ${row.ca_moi_id}` : "")]);
    return { ok: true };
  }
  if (caMoiId === "") {
    await env.DB.batch([upsert(null, "xac_nhan", {}), ghiNhatKy(env, caseGoc, "khong_co_ca_moi", ai, "Xác nhận không có ca mới")]);
    return { ok: true };
  }
  const id = caMoiId.trim().toUpperCase();
  if (id === caseGoc) return { ok: false, error: "Ca mới phải khác ca gốc", status: 400 };
  let uv: Partial<UngVien> | undefined = (JSON.parse(row?.ung_vien_json || "[]") as UngVien[]).find((u) => u.id === id);
  if (!uv) {
    const c = await caseDvbh(env, id);
    if (!c) return { ok: false, error: "Không tìm thấy ca mới trên DVBH", status: 404 };
    uv = { tn_at: vnToIso(c.thoi_gian_cskh_tiep_nhan), ht_at: vnToIso(c.thoi_gian_hoan_thanh), tien_do: c.tien_do_hoan_thanh ?? "", san_pham: c.san_pham_bao_hanh ?? "" };
  }
  await env.DB.batch([upsert(id, "xac_nhan", uv), ghiNhatKy(env, caseGoc, "gan_ca_moi", ai, `Ca mới ${id}`)]);
  return { ok: true };
}

/**
 * Danh sach luong doi tra da gan case (tab "Luồng duyệt đổi trả" tren DVBH). trangThai: "dang_mo" | "ket_thuc" | ""
 * (tat ca). Mac dinh DVBH chi xin luong dang mo - nho tu ket thuc 30 ngay, so nay giu nho (~so luong moi trong 1-2 thang).
 */
export async function danhSachLuong(env: Env, trangThai = "") {
  const loc = trangThai === "dang_mo" ? " AND l.ket_thuc_at IS NULL" : trangThai === "ket_thuc" ? " AND l.ket_thuc_at IS NOT NULL" : "";
  const r = await env.DB.prepare(
    `SELECT l.dvbh_case_id AS case_id, l.trang_thai, l.loai_yeu_cau, l.serial, l.msg_count, l.origin_at, l.last_at,
            l.tiep_nhan_at, l.de_xuat_at, l.duyet_at, l.giao_xu_ly_at, l.len_so_at, l.len_do_at,
            l.ket_thuc_at, l.ket_thuc_boi, l.created_at,
            m.ca_moi_id, m.trang_thai_gan AS ca_moi_gan, m.ca_moi_tn_at, m.ca_moi_ht_at, m.ca_moi_tien_do
     FROM luong l LEFT JOIN ca_moi m ON m.case_goc = l.dvbh_case_id
     WHERE l.dvbh_case_id IS NOT NULL${loc}
     ORDER BY COALESCE(l.last_at, l.created_at) DESC`,
  ).all<Record<string, unknown>>();
  const chuaGan = await env.DB.prepare("SELECT COUNT(*) AS n FROM luong WHERE dvbh_case_id IS NULL").first<{ n: number }>();
  return { rows: r.results, luong_chua_gan: chuaGan?.n ?? 0 };
}

export const NGAY_TU_KET_THUC = 30;
export const LY_DO_TU_KET_THUC = `Tự động kết thúc luồng đổi trả do không tìm thấy thông tin trong ${NGAY_TU_KET_THUC} ngày`;

/**
 * Tu ket thuc luong doi tra dang mo khi KHONG co thong tin moi trong 30 ngay (chay ban dem). "Thong tin moi" = moc moi nhat
 * trong: thu cuoi, duyet, tao luong, ca moi mo/hoan thanh, nhat ky thao tac (mo lai, gan ca...). Sau khi ket thuc, he thong
 * khong con truy van DVBH cho ca nay; nguoi dung van nhap ma ca doi thu cong duoc (ganCaMoi - khong ton luot kiem tra).
 */
export async function tuKetThucLuong(env: Env) {
  const r = await env.DB.prepare(
    `SELECT l.dvbh_case_id AS case_id FROM luong l LEFT JOIN ca_moi m ON m.case_goc = l.dvbh_case_id
     WHERE l.dvbh_case_id IS NOT NULL AND l.ket_thuc_at IS NULL
       AND MAX(COALESCE(l.last_at, ''), COALESCE(l.duyet_at, ''), l.created_at, COALESCE(m.ca_moi_tn_at, ''), COALESCE(m.ca_moi_ht_at, ''),
               COALESCE((SELECT MAX(at) FROM nhat_ky n WHERE n.case_id = l.dvbh_case_id), ''))
           < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${NGAY_TU_KET_THUC} days')`,
  ).all<{ case_id: string }>();
  const stmts = r.results.flatMap(({ case_id }) => [
    env.DB.prepare(
      `UPDATE luong SET ket_thuc_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ket_thuc_boi = ?2, ket_thuc_ghi_chu = ?3
       WHERE dvbh_case_id = ?1 AND ket_thuc_at IS NULL`,
    ).bind(case_id, HE_THONG, LY_DO_TU_KET_THUC),
    ghiNhatKy(env, case_id, "ket_thuc", { nguoi: HE_THONG }, LY_DO_TU_KET_THUC),
  ]);
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { ok: true, da_ket_thuc: r.results.map((x) => x.case_id) };
}
