// Phan tich noi dung mail: tieu de, chuoi thu trich dan (Outlook/Gmail), bang de xuat doi may.

export interface Addr {
  name: string;
  email: string;
}

export interface SubjectInfo {
  coTienTo: boolean; // co RE:/FW:... o dau
  goc: string; // tieu de da bo tien to
  loai: string; // HỖ TRỢ ĐỔI MÁY ...
  maCase: string; // ma o cuoi tieu de (1347322 / SC26100171)
  serial: string;
}

const PREFIX_RE = /^\s*(re|fw|fwd|tl|tr|aw|sv|vs)\s*(\[\d+\])?\s*:\s*/i;
const MA_CASE_RE = /^(\d{6,8}|SC\d{6,12})$/i;
// Khong dung \b vi "_" la ky tu tu -> "..._SNYU9U5JRCNZ_..." se khong khop.
const SERIAL_RE = /(?<![A-Za-z0-9])SN[A-Z0-9]{8,14}(?![A-Za-z0-9])/i;

export function phanTichTieuDe(raw: string): SubjectInfo {
  let s = raw.trim();
  let coTienTo = false;
  while (PREFIX_RE.test(s)) {
    s = s.replace(PREFIX_RE, "");
    coTienTo = true;
  }
  // "HỖ TRỢ ĐỔI MÁY: ..." | "GQKN_HỖ TRỢ ĐỔI SP ANH SANG_..." | "HỖ TRỢ CTCN _STCL_ ..."
  const loai = (s.match(/HỖ TRỢ(?:\s+[^\s:_\-]+){1,2}/iu)?.[0] ?? "").trim().toUpperCase();
  const tokens = s.split("_").map((t) => t.trim());
  const cuoi = tokens[tokens.length - 1] ?? "";
  const maCase = tokens.length > 1 && MA_CASE_RE.test(cuoi) ? cuoi.toUpperCase() : (s.match(/\bSC\d{8,12}\b/i)?.[0] ?? "").toUpperCase();
  return { coTienTo, goc: s, loai, maCase, serial: timSerial(s) };
}

export function timSerial(text: string): string {
  return (text.match(SERIAL_RE)?.[0] ?? "").toUpperCase();
}

export function parseAddress(raw: string): Addr {
  const cleaned = raw.replace(/<mailto:[^>]*>/gi, "").trim();
  const m = cleaned.match(/^\s*['"]?([^'"<\[]*?)['"]?\s*[<\[](?:mailto:)?([^>\]\s]+)[>\]]/i);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  const email = cleaned.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ?? "";
  return { name: email ? cleaned.replace(email, "").replace(/[<>"']/g, "").trim() : cleaned, email: email.toLowerCase() };
}

export function tatCaEmail(...lists: string[]): string[] {
  return lists.flatMap((l) => [...(l ?? "").matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)].map((m) => m[0].toLowerCase()));
}

export function domainOf(email: string): string {
  return email.includes("@") ? email.split("@").pop()! : "";
}

// ---------------------------------------------------------------- chuoi trich dan

export interface ThuTrichDan {
  from: Addr;
  sentAt: string; // ISO UTC
  to: string;
  cc: string;
  subject: string;
  body: string;
}

const HEADER_KEYS: Record<string, string> = {
  from: "from",
  "từ": "from",
  sent: "sent",
  date: "sent",
  "đã gửi": "sent",
  "ngày": "sent",
  to: "to",
  "đến": "to",
  cc: "cc",
  subject: "subject",
  "chủ đề": "subject",
};

/**
 * Tach cac thu cu nam trong phan trich dan (khoi "From:/Sent:/To:/Cc:/Subject:" cua Outlook,
 * "---------- Forwarded message" cua Gmail). Tra ve theo thu tu xuat hien (moi -> cu).
 */
export function tachTrichDan(body: string): ThuTrichDan[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: { start: number; end: number; h: Record<string, string> }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\*?(From|Từ)\s*:\*?\s+\S/i.test(lines[i])) continue;
    // Doc toi da 8 dong header lien tiep (ke ca dong noi tiep cua To/Cc dai).
    const h: Record<string, string> = {};
    let j = i;
    let lastKey = "";
    for (; j < Math.min(lines.length, i + 12); j++) {
      const m = lines[j].match(/^\s*\*?([A-Za-zÀ-ỹ ]{2,8})\s*:\*?\s*(.*)$/u);
      const key = m ? HEADER_KEYS[m[1].trim().toLowerCase()] : undefined;
      if (key) {
        h[key] = m![2].trim();
        lastKey = key;
      } else if (lines[j].trim() === "") {
        break;
      } else if (lastKey === "to" || lastKey === "cc") {
        h[lastKey] += " " + lines[j].trim();
      } else {
        break;
      }
    }
    if (h.from && h.sent && h.subject !== undefined) {
      blocks.push({ start: i, end: j, h });
      i = j;
    }
  }
  return blocks.map((b, k) => {
    const nextStart = blocks[k + 1]?.start ?? lines.length;
    return {
      from: parseAddress(b.h.from),
      sentAt: parseNgayOutlook(b.h.sent),
      to: b.h.to ?? "",
      cc: b.h.cc ?? "",
      subject: b.h.subject ?? "",
      body: catChuKy(lines.slice(b.end, nextStart).join("\n")).slice(0, 20_000),
    };
  }).filter((t) => t.sentAt);
}

const THANG_VI: Record<string, number> = {};
for (let i = 1; i <= 12; i++) THANG_VI[String(i)] = i;

/** "Thursday, October 8, 2026 10:34 AM" | "Thứ Năm, 8 tháng 10, 2026 10:34 SA" | "Thu, Oct 8, 2026 at 10:34 AM". Gio VN. */
export function parseNgayOutlook(raw: string): string {
  const s = raw.trim();
  const vi = s.match(/(\d{1,2})\s*tháng\s*(\d{1,2}),?\s*(\d{4})\D+(\d{1,2}):(\d{2})\s*(SA|CH)?/iu);
  if (vi) {
    let hh = Number(vi[4]);
    if (vi[6]?.toUpperCase() === "CH" && hh < 12) hh += 12;
    if (vi[6]?.toUpperCase() === "SA" && hh === 12) hh = 0;
    return new Date(Date.UTC(+vi[3], +vi[2] - 1, +vi[1], hh - 7, +vi[5])).toISOString();
  }
  const en = s.replace(/^[A-Za-z]+,\s*/, "").replace(/\s+at\s+/i, " ");
  const t = Date.parse(/[+-]\d{4}|GMT|UTC/i.test(en) ? en : en + " GMT+0700");
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

/** Phan noi dung moi cua 1 thu: cat tu dong trich dan / khoi header thu cu dau tien. */
export function phanMoi(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const markers = [
    /^On .+wrote:\s*$/i,
    /^Vào .+đã viết:\s*$/i,
    /^-{2,}\s*(Original Message|Forwarded message|Thư gốc|Tin nhắn đã chuyển tiếp)/i,
    /^\*?(From|Từ)\s*:\*?\s+\S/i,
    /^_{10,}\s*$/,
  ];
  const out: string[] = [];
  for (const line of lines) {
    if (markers.some((re) => re.test(line.trim()))) break;
    if (line.trimStart().startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function catChuKy(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------- bang de xuat

const COT_DE_XUAT = ["mã yêu cầu", "số serial"];

/**
 * Tim bang de xuat doi may trong HTML (hang tieu de co "Mã Yêu Cầu"/"Số Serial", hang ngay sau la gia tri).
 * Tra ve { "Hãng": "LIVOTEC", ..., "Mã Yêu Cầu": "1347322" } hoac {} neu khong co.
 */
export function bangDeXuat(html: string): Record<string, string> {
  if (!html) return {};
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => htmlText(c[1])),
  );
  for (let i = 0; i < rows.length - 1; i++) {
    const head = rows[i].map((c) => c.toLowerCase());
    if (!COT_DE_XUAT.every((k) => head.includes(k))) continue;
    const vals = rows[i + 1];
    const out: Record<string, string> = {};
    rows[i].forEach((h, k) => {
      if (h) out[h] = (vals[k] ?? "").trim();
    });
    return out;
  }
  return {};
}

function htmlText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- moc duyet

// So khop tren chu da bo dau -> bat ca loi go "Đông ý", "dong y".
const DONG_Y_RE = /\b(dong\s*y|da\s+duyet|duyet\s+(doi|cho|de\s+xuat)|approved?)\b/;
const PHU_DINH_RE = /\b(khong|chua|ko|k)\s+(dong\s*y|duyet)\b/;
const NHO_DUYET_RE = /\b(nho|xin|de\s+nghi|can|cho|ho\s+tro)\s+(\S+\s+){0,3}(duyet|dong\s*y)\b/;
const BEN_DUYET = "dichvu3t.com"; // TBP 3T duyet de xuat do Karofi gui

/** Thu TBP 3T dong y de xuat doi (goi y tu dong, nguoi dung xac nhan tren bao cao). */
export function laThuDuyet(fromEmail: string, bodyNew: string): boolean {
  if (domainOf(fromEmail) !== BEN_DUYET) return false;
  const text = boDau(bodyNew.slice(0, 1500));
  return DONG_Y_RE.test(text) && !PHU_DINH_RE.test(text) && !NHO_DUYET_RE.test(text);
}

/**
 * Thu de xuat: thu moi (khong RE/FW) co "HỖ TRỢ ..." trong tieu de, ben ngoai 3T gui TOI 3T.
 * (Thu sieu thi bao hang loi gui Karofi = diem phat sinh, khong phai de xuat.)
 */
export function laThuDeXuat(fromEmail: string, toAddr: string, tieuDe: SubjectInfo): boolean {
  return (
    !tieuDe.coTienTo &&
    tieuDe.loai !== "" &&
    domainOf(fromEmail) !== BEN_DUYET &&
    tatCaEmail(toAddr).some((e) => domainOf(e) === BEN_DUYET)
  );
}

// ---------------------------------------------------------------- moc sau duyet (noi bo Karofi)

const GIAO_XU_LY_RE = /\btheo\s+(e-?mail|mail|thu)\s+(phe\s+duyet|duyet)\b|\bho\s+tro\s+xu\s+ly\s+doi\b/;
// Giu chu hoa de phan biet "SO"/"DO" voi chu thuong; chi tinh khi DA lam ("đã lên SO"), khong tinh
// cau giao viec "cập nhật ngày lên đơn + SO + DO".
const DA_LAM = String.raw`\b[Dd]a\s+(?:[Ll]en|[Tt]ao|[Xx]uat|[Gg]iao|[Ll]am)\s+[^.\n]{0,40}?`;
const LEN_SO_RE = new RegExp(DA_LAM + String.raw`\bSO\b`);
const LEN_DO_RE = new RegExp(DA_LAM + String.raw`\bDO\b`);

/** Moc sau duyet cua 1 thu (ben ngoai 3T gui). '' neu khong phai. */
export function mocSauDuyet(fromEmail: string, bodyNew: string): string {
  if (domainOf(fromEmail) === BEN_DUYET) return "";
  const text = bodyNew.slice(0, 1500);
  const giuHoa = text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D");
  const so = LEN_SO_RE.test(giuHoa);
  const doo = LEN_DO_RE.test(giuHoa);
  if (so && doo) return "len_so_do";
  if (doo) return "len_do";
  if (so) return "len_so";
  if (GIAO_XU_LY_RE.test(giuHoa.toLowerCase())) return "giao_xu_ly";
  return "";
}

export function boDau(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}
