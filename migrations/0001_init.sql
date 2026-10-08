-- Moi "ca" = 1 luong nghiep vu (co the gom nhieu luong Gmail neu cung ma ca).
CREATE TABLE cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,          -- CA-2026-00001
  subject       TEXT NOT NULL DEFAULT '',      -- tieu de mail goc
  origin_name   TEXT NOT NULL DEFAULT '',
  origin_email  TEXT NOT NULL DEFAULT '',      -- ai mo ca
  origin_domain TEXT NOT NULL DEFAULT '',      -- mo ca tu dau (ten mien nguoi gui)
  origin_at     TEXT NOT NULL,                 -- ISO UTC, thoi diem mail goc
  last_at       TEXT NOT NULL,
  last_from     TEXT NOT NULL DEFAULT '',
  msg_count     INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'moi',   -- moi | dang_xu_ly | cho_phan_hoi | da_xong | huy
  assignee      TEXT NOT NULL DEFAULT '',
  customer      TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_cases_last_at ON cases(last_at);
CREATE INDEX idx_cases_status ON cases(status);

CREATE TABLE messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      INTEGER NOT NULL REFERENCES cases(id),
  gmail_id     TEXT NOT NULL UNIQUE,
  thread_id    TEXT NOT NULL DEFAULT '',
  message_id   TEXT NOT NULL DEFAULT '',       -- header Message-ID (khong co <>)
  in_reply_to  TEXT NOT NULL DEFAULT '',
  refs         TEXT NOT NULL DEFAULT '',
  from_name    TEXT NOT NULL DEFAULT '',
  from_email   TEXT NOT NULL DEFAULT '',
  to_addr      TEXT NOT NULL DEFAULT '',
  cc_addr      TEXT NOT NULL DEFAULT '',
  subject      TEXT NOT NULL DEFAULT '',
  sent_at      TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',       -- toan bo noi dung text
  body_new     TEXT NOT NULL DEFAULT '',       -- phan moi (da cat phan trich dan)
  attachments  TEXT NOT NULL DEFAULT '[]',     -- JSON [{name,size,type}]
  link_method  TEXT NOT NULL DEFAULT '',       -- ma-ca | references | thread | moi
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_messages_case ON messages(case_id, sent_at);
CREATE INDEX idx_messages_message_id ON messages(message_id);
CREATE INDEX idx_messages_thread ON messages(thread_id);

CREATE TABLE counters (
  year INTEGER PRIMARY KEY,
  n    INTEGER NOT NULL
);
