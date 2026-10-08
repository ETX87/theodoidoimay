-- Ca MOI mo de doi may cho KH, noi voi ca GOC chi theo case_dvbh.id_khach_hang (chot: khong tra SDT).
-- Odoo: 1 ID khach hang co the la dai ly/sieu thi dung chung nhieu khach le -> chi tu gan khi DUNG 1 ung vien
-- khop model; con lai de nguoi dung xac nhan (trang_thai_gan = 'xac_nhan' duoc giu qua cac lan dong bo).
CREATE TABLE ca_moi (
  case_goc        TEXT PRIMARY KEY,
  id_khach_hang   TEXT NOT NULL DEFAULT '',
  ca_moi_id       TEXT,                         -- NULL = chua xac dinh
  trang_thai_gan  TEXT NOT NULL DEFAULT 'chua_co', -- tu_dong | xac_nhan | goi_y | nhieu_ung_vien | chua_co | khong_co_id_kh
  ung_vien_json   TEXT NOT NULL DEFAULT '[]',   -- [{id, tn_at, san_pham, tien_do, khop_model}]
  ca_moi_tn_at    TEXT,                         -- mo ca moi (thoi_gian_cskh_tiep_nhan) - ISO UTC
  ca_moi_ht_at    TEXT,                         -- ca moi hoan thanh = doi tra thanh cong
  ca_moi_tien_do  TEXT NOT NULL DEFAULT '',
  ca_moi_san_pham TEXT NOT NULL DEFAULT '',
  nguoi_xac_nhan  TEXT NOT NULL DEFAULT '',
  synced_at       TEXT NOT NULL
);
