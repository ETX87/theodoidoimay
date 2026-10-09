-- Chong do mat khau trang bao cao: ghi moi lan dang nhap SAI theo IP; >= 10 lan / 15 phut -> tu choi (429).
-- Binding ratelimits cua Cloudflare "permissive by design" (production khong chan duoc) -> dung bang dem nay. Cron dem xoa > 1 ngay.
CREATE TABLE dang_nhap_sai (
  ip TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_dang_nhap_sai ON dang_nhap_sai(ip, at);
