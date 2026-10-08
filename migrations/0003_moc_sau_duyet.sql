-- Moc sau duyet (quy trinh noi bo Karofi): giao xu ly -> len SO -> len DO. Chi ghi thoi gian + trang thai.
ALTER TABLE thu ADD COLUMN moc TEXT NOT NULL DEFAULT '';      -- '' | giao_xu_ly | len_so | len_do | len_so_do

ALTER TABLE luong ADD COLUMN giao_xu_ly_at TEXT;
ALTER TABLE luong ADD COLUMN len_so_at TEXT;
ALTER TABLE luong ADD COLUMN len_do_at TEXT;
-- phat_sinh | cho_duyet | da_duyet | giao_xu_ly | da_len_so | da_len_do
ALTER TABLE luong ADD COLUMN trang_thai TEXT NOT NULL DEFAULT 'phat_sinh';
CREATE INDEX idx_luong_trang_thai ON luong(trang_thai);
