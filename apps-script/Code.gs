/**
 * Thư ký mail đổi máy — đồng bộ Gmail theodoidoimay@gmail.com lên Cloudflare (Worker theodoidoimay).
 *
 * Bản 2: dùng Gmail API (dịch vụ nâng cao) thay cho GmailApp.
 *   - Mỗi mail chỉ tốn 1 lượt gọi (format "full": header + text + HTML + danh sách đính kèm).
 *   - Lượt chạy định kỳ chỉ hỏi Gmail "có gì mới từ lần trước" (history) → không có mail mới = 1 lượt gọi.
 *   - Không dùng chung hạn mức "Service invoked too many times for one day: gmail" của GmailApp.
 *
 * Cài đặt (1 lần):
 *   1. Đăng nhập theodoidoimay@gmail.com → https://script.google.com → mở dự án → dán toàn bộ file này → Lưu.
 *   2. Cột trái, mục "Dịch vụ" (Services) bấm dấu + → chọn "Gmail API" → Thêm (giữ tên mặc định "Gmail").
 *   3. Cài đặt dự án → Thuộc tính tập lệnh: INGEST_KEY = <khoá được cấp> (đã có thì giữ nguyên).
 *   4. Chọn hàm `caiDat` → Chạy → cấp quyền. Hàm này tạo trigger 5 phút và quét lại 30 ngày gần nhất.
 *
 * Worker tự bỏ qua mail trùng nên chạy lại bao nhiêu lần cũng không sao.
 */

const CONFIG = {
  WORKER_URL: 'https://theodoidoimay.dichvu3t.workers.dev/api/ingest',
  LOOKBACK_DAYS_FIRST_RUN: 30,
  BATCH_SIZE: 10, // mỗi thư kèm HTML (tối đa 300KB)
  MAX_RUN_MS: 4 * 60 * 1000, // Apps Script giới hạn 6 phút/lần
  BO_QUA_NHAN: ['SPAM', 'TRASH', 'DRAFT', 'CHAT'],
};

function caiDat() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'dongBoMail')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dongBoMail').timeBased().everyMinutes(5).create();
  Logger.log('Đã tạo trigger dongBoMail mỗi 5 phút.');
  kiemTraKetNoi();
  quetLaiTuDau();
}

function kiemTraKetNoi() {
  guiLen_([]);
  Logger.log('Kết nối Worker OK.');
}

/** Lượt định kỳ: chỉ lấy mail mới kể từ HISTORY_ID lần trước. */
function dongBoMail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    Logger.log('Đang có lượt đồng bộ khác chạy, bỏ qua lượt này.');
    return;
  }
  try {
    const props = PropertiesService.getScriptProperties();
    const historyId = props.getProperty('HISTORY_ID');
    if (!historyId) {
      quetDanhSach_('newer_than:' + CONFIG.LOOKBACK_DAYS_FIRST_RUN + 'd');
      return;
    }
    const ids = [];
    let pageToken;
    let newest = historyId;
    try {
      do {
        const res = Gmail.Users.History.list('me', {
          startHistoryId: historyId,
          historyTypes: ['messageAdded'],
          pageToken: pageToken,
          maxResults: 500,
        });
        (res.history || []).forEach((h) => (h.messagesAdded || []).forEach((a) => ids.push(a.message.id)));
        if (res.historyId) newest = res.historyId;
        pageToken = res.nextPageToken;
      } while (pageToken);
    } catch (e) {
      // HISTORY_ID quá cũ (Gmail chỉ giữ ~1 tuần) → quét lại 7 ngày, Worker tự bỏ trùng.
      Logger.log('History hết hạn (' + e.message + '), quét lại 7 ngày.');
      quetDanhSach_('newer_than:7d');
      return;
    }
    if (ids.length) {
      Logger.log('Có ' + ids.length + ' mail mới.');
      guiTheoId_(uniq_(ids));
    }
    props.setProperty('HISTORY_ID', String(newest));
  } finally {
    lock.releaseLock();
  }
}

/** Quét lại toàn bộ 30 ngày gần nhất (dùng khi cài đặt hoặc cần nạp lại). */
function quetLaiTuDau() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    Logger.log('Đang có lượt đồng bộ khác chạy, thử lại sau 1 phút.');
    return;
  }
  try {
    quetDanhSach_('newer_than:' + CONFIG.LOOKBACK_DAYS_FIRST_RUN + 'd');
  } finally {
    lock.releaseLock();
  }
}

function quetDanhSach_(query) {
  const props = PropertiesService.getScriptProperties();
  // Lấy mốc history TRƯỚC khi quét → mail đến trong lúc quét sẽ được lượt sau bắt lại.
  const startHistoryId = Gmail.Users.getProfile('me').historyId;
  Logger.log('Quét danh sách: ' + query);
  const ids = [];
  let pageToken;
  do {
    const res = Gmail.Users.Messages.list('me', { q: query + ' -in:chats', pageToken: pageToken, maxResults: 500 });
    (res.messages || []).forEach((m) => ids.push(m.id));
    pageToken = res.nextPageToken;
  } while (pageToken);
  Logger.log('Tìm thấy ' + ids.length + ' mail.');
  const xong = guiTheoId_(ids.reverse()); // cũ trước, mới sau
  if (xong) {
    props.setProperty('HISTORY_ID', String(startHistoryId));
    Logger.log('Xong. Lượt 5 phút sẽ chỉ lấy mail mới từ đây.');
  } else {
    Logger.log('Hết thời gian lượt này; lượt sau sẽ quét tiếp (Worker tự bỏ trùng).');
  }
}

/** Lấy từng mail (1 lượt gọi/mail) và gửi theo lô. Trả về false nếu dừng giữa chừng vì hết giờ. */
function guiTheoId_(ids) {
  const started = Date.now();
  let batch = [];
  for (let i = 0; i < ids.length; i++) {
    if (Date.now() - started > CONFIG.MAX_RUN_MS) {
      if (batch.length) guiLen_(batch);
      return false;
    }
    const msg = layThu_(ids[i]);
    if (msg) batch.push(msg);
    if (batch.length >= CONFIG.BATCH_SIZE) {
      guiLen_(batch);
      batch = [];
    }
  }
  if (batch.length) guiLen_(batch);
  return true;
}

function layThu_(id) {
  let m;
  try {
    m = Gmail.Users.Messages.get('me', id, { format: 'full' });
  } catch (e) {
    Logger.log('Bỏ qua mail ' + id + ': ' + e.message); // mail đã bị xoá
    return null;
  }
  if ((m.labelIds || []).some((l) => CONFIG.BO_QUA_NHAN.indexOf(l) >= 0)) return null;

  const headers = {};
  (m.payload.headers || []).forEach((h) => (headers[h.name.toLowerCase()] = h.value));
  const out = { plain: '', html: '', attachments: [] };
  duyetPhan_(id, m.payload, out);

  return {
    gmailId: m.id,
    threadId: m.threadId,
    messageId: headers['message-id'] || '',
    inReplyTo: headers['in-reply-to'] || '',
    references: headers['references'] || '',
    from: headers['from'] || '',
    to: headers['to'] || '',
    cc: headers['cc'] || '',
    subject: headers['subject'] || '',
    date: new Date(Number(m.internalDate)).toISOString(),
    body: out.plain.slice(0, 100000),
    html: out.html.slice(0, 300000),
    attachments: out.attachments,
  };
}

function duyetPhan_(msgId, part, out) {
  if (!part) return;
  const mime = (part.mimeType || '').toLowerCase();
  if (part.filename) {
    out.attachments.push({ name: part.filename, size: (part.body && part.body.size) || 0, type: mime });
  } else if (mime === 'text/plain' && !out.plain) {
    out.plain = docNoiDung_(msgId, part);
  } else if (mime === 'text/html' && !out.html) {
    out.html = docNoiDung_(msgId, part);
  }
  (part.parts || []).forEach((p) => duyetPhan_(msgId, p, out));
}

function docNoiDung_(msgId, part) {
  let data = part.body && part.body.data;
  // Phần text rất lớn được Gmail tách ra như đính kèm.
  if (!data && part.body && part.body.attachmentId) {
    data = Gmail.Users.Messages.Attachments.get('me', msgId, part.body.attachmentId).data;
  }
  if (!data) return '';
  const bytes = typeof data === 'string' ? Utilities.base64DecodeWebSafe(data) : data;
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
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
  if (messages.length) {
    const r = JSON.parse(res.getContentText());
    Logger.log('  Worker: mới ' + r.inserted + ', trùng ' + r.duplicates + ', loại ' + r.skipped +
      ', thư trích dẫn ' + r.quoted + ', bổ sung HTML ' + (r.htmlBoSung || 0));
  }
  return res.getContentText();
}

function uniq_(arr) {
  const seen = {};
  return arr.filter((x) => (seen[x] ? false : (seen[x] = true)));
}
