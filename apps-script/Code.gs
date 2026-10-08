/**
 * Thư ký mail đổi máy — đồng bộ Gmail theodoidoimay@gmail.com lên Cloudflare (Worker thuky-mail).
 *
 * Cài đặt (1 lần):
 *   1. Đăng nhập theodoidoimay@gmail.com → https://script.google.com → Dự án mới → dán toàn bộ file này.
 *   2. Biểu tượng bánh răng (Cài đặt dự án) → "Thuộc tính tập lệnh" → thêm INGEST_KEY = <khoá được cấp>.
 *   3. Chọn hàm `caiDat` → Chạy → cấp quyền Gmail + kết nối bên ngoài.
 *      Hàm này tạo trigger chạy `dongBoMail` mỗi 5 phút và chạy thử 1 lần ngay.
 *
 * Cách hoạt động: quét mail theo cửa sổ thời gian (cũ → mới), gửi lên Worker theo lô.
 * Worker tự bỏ qua mail trùng nên chạy lại / chồng lấn thời gian không sao.
 * Chỉ khi Worker trả 200 mới lưu mốc LAST_SYNC_MS → lỗi mạng thì lần sau gửi lại.
 */

const CONFIG = {
  WORKER_URL: 'https://thuky-mail.dichvu3t.workers.dev/api/ingest',
  LOOKBACK_DAYS_FIRST_RUN: 30, // lần đầu lấy lại mail 30 ngày gần nhất
  WINDOW_HOURS: 24, // mỗi cửa sổ quét 1 ngày
  OVERLAP_MINUTES: 30, // quét chồng lên cửa sổ trước để không sót mail đến trễ
  BATCH_SIZE: 20,
  MAX_RUN_MS: 4 * 60 * 1000, // Apps Script giới hạn 6 phút/lần
};

function caiDat() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'dongBoMail')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dongBoMail').timeBased().everyMinutes(5).create();
  kiemTraKetNoi();
  dongBoMail();
}

function kiemTraKetNoi() {
  const res = guiLen_([]);
  Logger.log('Kết nối Worker OK: ' + res);
}

function dongBoMail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // lần trước còn đang chạy
  try {
    const props = PropertiesService.getScriptProperties();
    const started = Date.now();
    let last = Number(props.getProperty('LAST_SYNC_MS') || 0);
    if (!last) last = started - CONFIG.LOOKBACK_DAYS_FIRST_RUN * 86400000;

    while (last < Date.now() && Date.now() - started < CONFIG.MAX_RUN_MS) {
      const until = Math.min(Date.now(), last + CONFIG.WINDOW_HOURS * 3600000);
      const since = last - CONFIG.OVERLAP_MINUTES * 60000;
      const sent = quetCuaSo_(since, until);
      props.setProperty('LAST_SYNC_MS', String(until));
      if (sent) Logger.log('Đã gửi ' + sent + ' mail (' + new Date(since) + ' → ' + new Date(until) + ')');
      last = until;
    }
  } finally {
    lock.releaseLock();
  }
}

/** Đặt lại mốc để lần chạy sau quét lại từ đầu (Worker vẫn tự bỏ trùng). */
function quetLaiTuDau() {
  PropertiesService.getScriptProperties().deleteProperty('LAST_SYNC_MS');
  dongBoMail();
}

function quetCuaSo_(sinceMs, untilMs) {
  // Gồm hộp thư đến, đã gửi, lưu trữ; Gmail tự loại thư rác và thùng rác.
  const query = 'after:' + Math.floor(sinceMs / 1000) + ' before:' + Math.ceil(untilMs / 1000 + 1) + ' -in:chats';
  let batch = [];
  let total = 0;
  for (let start = 0; ; start += 100) {
    const threads = GmailApp.search(query, start, 100);
    threads.forEach((t) => {
      t.getMessages().forEach((m) => {
        if (m.getDate().getTime() < sinceMs) return;
        batch.push(chuyenDoi_(t, m));
        if (batch.length >= CONFIG.BATCH_SIZE) {
          guiLen_(batch);
          total += batch.length;
          batch = [];
        }
      });
    });
    if (threads.length < 100) break;
  }
  if (batch.length) {
    guiLen_(batch);
    total += batch.length;
  }
  return total;
}

function chuyenDoi_(thread, m) {
  const attachments = m.getAttachments({ includeInlineImages: false }).map((a) => ({
    name: a.getName(),
    size: a.getSize(),
    type: a.getContentType(),
  }));
  return {
    gmailId: m.getId(),
    threadId: thread.getId(),
    messageId: m.getHeader('Message-ID'),
    inReplyTo: m.getHeader('In-Reply-To'),
    references: m.getHeader('References'),
    from: m.getFrom(),
    to: m.getTo(),
    cc: m.getCc(),
    subject: m.getSubject(),
    date: m.getDate().toISOString(),
    body: (m.getPlainBody() || '').slice(0, 50000),
    attachments: attachments,
  };
}

function guiLen_(messages) {
  const key = PropertiesService.getScriptProperties().getProperty('INGEST_KEY');
  if (!key) throw new Error('Chưa đặt INGEST_KEY trong Thuộc tính tập lệnh');
  const res = UrlFetchApp.fetch(CONFIG.WORKER_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Ingest-Key': key },
    payload: JSON.stringify({ messages: messages }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Worker trả lỗi ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
  return res.getContentText();
}
