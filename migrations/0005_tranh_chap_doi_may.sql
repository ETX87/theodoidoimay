-- Ban sao CHI DOC cua ho so "Tranh chấp, khiếu nại" ben DVBH (tranh_chap_tien_trinh + tranh_chap_log)
-- lien quan doi may: phan loai "KH đòi đổi máy"/"Đổi trả" + moi ho so cua case co luong mail.
-- Dong bo 3 gio/lan (src/baoCao.ts dongBoTranhChap) - bao cao chi doc bang nay, khong doc DVBH khi xem.
CREATE TABLE tc_doi_may (
  tien_trinh_id TEXT PRIMARY KEY,           -- TC-001128
  case_id       TEXT NOT NULL,
  phan_loai     TEXT NOT NULL DEFAULT '',
  muc_do        TEXT NOT NULL DEFAULT '',
  nguoi_tao     TEXT NOT NULL DEFAULT '',
  yc_at         TEXT,                       -- ngay tao ho so (Giam sat chuyen CSKH) - ISO UTC
  cskh_at       TEXT,                       -- log CSKH dau tien
  ket_thuc_at   TEXT,                       -- log dong ho so dau tien
  ket_thuc_loai TEXT NOT NULL DEFAULT '',   -- hoan_thanh | that_bai | ''
  trang_thai    TEXT NOT NULL DEFAULT '',   -- trang thai log moi nhat
  ket_qua       TEXT NOT NULL DEFAULT '',
  cap_nhat_at   TEXT,                       -- log moi nhat
  logs_json     TEXT NOT NULL DEFAULT '[]',
  hang          TEXT NOT NULL DEFAULT '',
  khu_vuc       TEXT NOT NULL DEFAULT '',
  tinh          TEXT NOT NULL DEFAULT '',
  ky_thuat_vien TEXT NOT NULL DEFAULT '',
  san_pham      TEXT NOT NULL DEFAULT '',
  synced_at     TEXT NOT NULL
);
CREATE INDEX idx_tc_case ON tc_doi_may(case_id);

CREATE TABLE dong_bo (
  ten        TEXT PRIMARY KEY,               -- 'tranh_chap'
  lan_cuoi   TEXT NOT NULL,
  ket_qua    TEXT NOT NULL DEFAULT ''
);
