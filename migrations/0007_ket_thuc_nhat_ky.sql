-- Ket thuc luong doi tra (nguoi dung xac nhan tren DVBH) + nhat ky thao tac (ai ket thuc, he thong/ai gan ca moi).
-- Luong da ket thuc: KHONG con truy van DVBH (dong bo 3h, tim ca moi, gan lai ban dem) - thu moi van duoc luu.
ALTER TABLE luong ADD COLUMN ket_thuc_at TEXT;                               -- ISO UTC, NULL = dang mo
ALTER TABLE luong ADD COLUMN ket_thuc_boi TEXT NOT NULL DEFAULT '';
ALTER TABLE luong ADD COLUMN ket_thuc_ghi_chu TEXT NOT NULL DEFAULT '';

-- Nhat ky moi thao tac tren luong doi tra cua 1 case (ai lam / he thong tu dong).
CREATE TABLE nhat_ky (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     TEXT NOT NULL,
  hanh_dong   TEXT NOT NULL,      -- tao_tu_mail | ket_thuc | mo_lai | gan_ca_moi | khong_co_ca_moi | bo_ca_moi
  nguoi       TEXT NOT NULL,      -- 'Hệ thống' hoac ten nguoi dung DVBH / 'Trang báo cáo'
  nguoi_email TEXT NOT NULL DEFAULT '',
  chi_tiet    TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_nhat_ky_case ON nhat_ky(case_id, at);

-- Ghi lai moc "he thong tu dong them" cho cac luong da gan case truoc khi co nhat ky.
INSERT INTO nhat_ky (case_id, hanh_dong, nguoi, chi_tiet, at)
SELECT dvbh_case_id, 'tao_tu_mail', 'Hệ thống', 'Tự động từ mail (gắn theo mã case/serial)', COALESCE(origin_at, created_at)
FROM luong WHERE dvbh_case_id IS NOT NULL;
INSERT INTO nhat_ky (case_id, hanh_dong, nguoi, chi_tiet, at)
SELECT case_goc, 'gan_ca_moi', CASE WHEN trang_thai_gan = 'tu_dong' THEN 'Hệ thống' ELSE 'Trang báo cáo' END,
       'Ca mới ' || ca_moi_id, synced_at
FROM ca_moi WHERE ca_moi_id IS NOT NULL;
