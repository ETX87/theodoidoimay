// Lam gon noi dung thu de HIEN THI (khong doi du lieu goc thu.body_new).
// Van de: mail Outlook co bang HTML -> ban text/plain (va phan trich dan) bi "dan phang" moi o 1 dong,
// vd bang de xuat 22 cot thanh 22 dong tieu de roi 22 dong gia tri -> doc rat roi.
//   - Bang de xuat (bat dau "Ngày TN/GS đề xuất"): cat tu do den het thu, thay bang 1 dong ghi chu (du lieu da tach o luong.de_xuat).
//   - Bang khac (>= 4 o tieu de ngan lien tiep + du so o gia tri): ghep thanh "Tiêu đề: giá trị".
//   - Bo chu ky (Tks/Trân trọng/Best regards/---), link trung lap "<mailto:..>"/"<https://..>", dong trong.

const CHU_KY_RE = /^(tks|thanks|thank you|trân trọng|tran trong|best regards|regards|em cảm ơn|cảm ơn|thân ái|-{5,}|_{5,})/i;
const CHAO_RE = /^(dear|kính gửi|kính trình|chào|gửi|hi|hello|cc\s)/i;
const BANG_DE_XUAT_RE = /^Ngày TN\/GS đề xuất$/i;
export const GHI_CHU_BANG_DE_XUAT = "[Bảng đề xuất đổi]";

/** O tieu de bang: ngan, khong so, khong dau cau cuoi, khong phai loi chao. */
function laNhan(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 35 || /\d/.test(t) || /[.!?,;:]$/.test(t) || CHAO_RE.test(t)) return false;
  return t.split(/\s+/).length <= 6 && /\p{L}/u.test(t);
}

export function lamGonThu(body: string): { noi_dung: string; tom_tat: string } {
  const text = String(body || "")
    .replace(/\r/g, "")
    .replace(/\s*<mailto:[^>]*>/gi, "")
    .replace(/\s*<https?:\/\/[^>]*>/gi, "")
    .replace(/\t+/g, " ");
  // "\n\n" = ranh gioi doan/o bang; o trong cua bang la " " -> giu lai de khong lech cap tieu de/gia tri.
  const o = text.split(/\n[ ]*\n/).map((s) => s.replace(/\s*\n\s*/g, " ").trimEnd());

  const ra: string[] = [];
  for (let i = 0; i < o.length; i++) {
    const s = o[i].trim();
    if (i > 0 && CHU_KY_RE.test(s)) break;
    if (BANG_DE_XUAT_RE.test(s)) {
      // O gia tri co the nhieu doan/o trong -> khong ghep cap duoc chac chan; bang luon nam cuoi thu (truoc chu ky)
      // va da tach day du tu HTML vao luong.de_xuat -> cat tu day den chu ky.
      ra.push(GHI_CHU_BANG_DE_XUAT);
      break;
    }
    if (laNhan(s)) {
      let k = 0;
      while (i + k < o.length && laNhan(o[i + k])) k++;
      if (k >= 4 && i + 2 * k <= o.length) {
        for (let j = 0; j < k; j++) {
          const v = o[i + k + j].trim();
          if (v) ra.push(`${o[i + j].trim()}: ${v}`);
        }
        i += 2 * k - 1;
        continue;
      }
    }
    if (s) ra.push(s);
  }

  const noiDung = ra.join("\n").slice(0, 6000);
  const tomTat =
    ra.find((s) => !CHAO_RE.test(s) && s !== GHI_CHU_BANG_DE_XUAT && s.length > 3) ?? ra[0] ?? "";
  return { noi_dung: noiDung, tom_tat: tomTat.length > 160 ? `${tomTat.slice(0, 157)}…` : tomTat };
}
