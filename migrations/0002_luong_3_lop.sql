-- Cau truc moi: luong (1 luong = 1 case DVBH neu xac dinh duoc) + thu + bo_qua.
-- Du lieu cu chi la mail demo -> xoa, Apps Script quet lai tu dau (quetLaiTuDau).
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS cases;
DROP TABLE IF EXISTS counters;

CREATE TABLE luong (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dvbh_case_id   TEXT UNIQUE,                    -- case_dvbh.id (1347322 / SC26100171), NULL neu chua gan
  match_status   TEXT NOT NULL DEFAULT 'chua_gan', -- da_gan | chua_gan | nhieu_ung_vien | cho_dvbh
  match_note     TEXT NOT NULL DEFAULT '',        -- JSON ung vien / ly do
  ma_trong_mail  TEXT NOT NULL DEFAULT '',        -- ma case doc duoc tu mail (co the chua co trong DVBH)
  serial         TEXT NOT NULL DEFAULT '',
  loai_yeu_cau   TEXT NOT NULL DEFAULT '',        -- HỖ TRỢ ĐỔI MÁY / HỖ TRỢ CTCN ...
  subject        TEXT NOT NULL DEFAULT '',        -- tieu de thu goc (bo RE/FW)
  origin_name    TEXT NOT NULL DEFAULT '',
  origin_email   TEXT NOT NULL DEFAULT '',
  origin_domain  TEXT NOT NULL DEFAULT '',
  origin_at      TEXT,
  last_at        TEXT,
  last_from      TEXT NOT NULL DEFAULT '',
  msg_count      INTEGER NOT NULL DEFAULT 0,
  de_xuat_at     TEXT,                            -- moc de xuat doi
  de_xuat_from   TEXT NOT NULL DEFAULT '',
  de_xuat_json   TEXT NOT NULL DEFAULT '{}',      -- bang 22 truong trong mail de xuat
  duyet_at       TEXT,                            -- moc duyet (goi y tu dong)
  duyet_from     TEXT NOT NULL DEFAULT '',
  duyet_text     TEXT NOT NULL DEFAULT '',
  duyet_xac_nhan INTEGER NOT NULL DEFAULT 0,      -- 1 = nguoi dung da xac nhan moc duyet
  dvbh_json      TEXT NOT NULL DEFAULT '{}',      -- anh chup thong tin case DVBH luc gan
  dvbh_checked_at TEXT,
  ghi_chu        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_luong_last_at ON luong(last_at);
CREATE INDEX idx_luong_match ON luong(match_status);
CREATE INDEX idx_luong_serial ON luong(serial);

CREATE TABLE thu (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  luong_id     INTEGER NOT NULL REFERENCES luong(id),
  nguon        TEXT NOT NULL,                     -- gmail | trich_dan
  gmail_id     TEXT NOT NULL UNIQUE,              -- trich_dan: 'q_' + hash(nguoi gui|phut gui|tieu de)
  thread_id    TEXT NOT NULL DEFAULT '',
  message_id   TEXT NOT NULL DEFAULT '',
  in_reply_to  TEXT NOT NULL DEFAULT '',
  refs         TEXT NOT NULL DEFAULT '',
  from_name    TEXT NOT NULL DEFAULT '',
  from_email   TEXT NOT NULL DEFAULT '',
  to_addr      TEXT NOT NULL DEFAULT '',
  cc_addr      TEXT NOT NULL DEFAULT '',
  subject      TEXT NOT NULL DEFAULT '',
  sent_at      TEXT NOT NULL,
  body_new     TEXT NOT NULL DEFAULT '',
  r2_key       TEXT NOT NULL DEFAULT '',          -- toan van text + html (chi thu gmail)
  attachments  TEXT NOT NULL DEFAULT '[]',
  link_method  TEXT NOT NULL DEFAULT '',          -- ma_case | references | thread | serial | trich_dan | moi
  la_de_xuat   INTEGER NOT NULL DEFAULT 0,
  la_duyet     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_thu_luong ON thu(luong_id, sent_at);
CREATE INDEX idx_thu_message_id ON thu(message_id);
CREATE INDEX idx_thu_thread ON thu(thread_id);
CREATE INDEX idx_thu_from_sent ON thu(from_email, sent_at);

CREATE TABLE bo_qua (
  gmail_id   TEXT PRIMARY KEY,
  from_email TEXT NOT NULL DEFAULT '',
  subject    TEXT NOT NULL DEFAULT '',
  sent_at    TEXT NOT NULL DEFAULT '',
  ly_do      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_bo_qua_created ON bo_qua(created_at);
