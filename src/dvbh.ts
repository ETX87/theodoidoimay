// Tra cuu DVBH (D1 dvbh-db-smarttrade) - CHI DOC. Moi query di theo cot co index (id, seri_san_pham)
// de khong anh huong ngan sach doc D1 cua DVBH (xem KE_HOACH_TOI_UU_D1.md ben DVBH).

export interface DvbhCase {
  id: string;
  khach_hang: string | null;
  khu_vuc: string | null;
  seri_san_pham: string | null;
  san_pham_bao_hanh: string | null;
  hang: string | null;
  tinh: string | null;
  ky_thuat_vien: string | null;
  tien_do_hoan_thanh: string | null;
  thoi_gian_cskh_tiep_nhan: string | null;
  thoi_gian_hoan_thanh: string | null;
  link_crm: string | null;
}

const COLS = `CAST(id AS TEXT) AS id, khach_hang, khu_vuc, seri_san_pham, san_pham_bao_hanh, hang, tinh, ky_thuat_vien,
  tien_do_hoan_thanh, thoi_gian_cskh_tiep_nhan, thoi_gian_hoan_thanh, link_crm`;

export async function caseTheoId(db: D1Database, id: string): Promise<DvbhCase | null> {
  return db.prepare(`SELECT ${COLS} FROM case_dvbh WHERE id = ?`).bind(id).first<DvbhCase>();
}

/** DVBH luu serial lan lon hoa/thuong (vd "snyu9u5jrcnz") -> tra ca 2 dang de van dung index. */
export async function caseTheoSerial(db: D1Database, serial: string): Promise<DvbhCase[]> {
  const res = await db
    .prepare(`SELECT ${COLS} FROM case_dvbh WHERE seri_san_pham IN (?1, ?2) ORDER BY thoi_gian_cskh_tiep_nhan DESC LIMIT 10`)
    .bind(serial.toUpperCase(), serial.toLowerCase())
    .all<DvbhCase>();
  return res.results;
}
