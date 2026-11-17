# Nhật ký làm việc — Thư ký mail đổi máy

> Mỗi đợt làm việc 1 mục, **mới nhất ở trên**: ngày, phiên bản, yêu cầu, đã làm gì, kiểm thử gì, việc còn dở. Chỉ ghi thêm, không xoá mục cũ.
> Không ghi tài khoản, mật khẩu, khoá hay mô tả lỗ hổng bảo mật vào file này (repo có thể công khai).

## 17/11/2026 — Tạo bộ tài liệu tổng hợp

- Yêu cầu: "dựa theo nguyên tắc tạo 3 file bắt buộc, rà soát toàn bộ các repo và tạo 3 file rồi đẩy lên repo etx87".
- Tạo `nhat_ky_lam_viec.md` (file này), `TONG_HOP_LOGIC.md`.
- Phần "Lịch sử dựng lại từ Git" bên dưới sinh tự động từ commit (bỏ commit gộp nhánh + commit tự động Workflow Mây). Từ nay ghi tay mục mới ở trên.

## Lịch sử dựng lại từ Git (26 commit, 2026-10-08 → 2026-11-17)

### 2026-10-21
- Tu dong ket thuc luong doi tra 3 ngay sau khi len SO/DO (ghi chu: Tu dong dong do KRF da len don tra), bo qua ca da mo lai (`c8a6768`)

### 2026-10-09
- Chong do mat khau bang bang dem D1 (10 lan sai/15 phut/IP, migration 0008) thay binding ratelimits (production khong chan) (`13e6bee`)
- Bao mat: gioi han dang nhap 5 lan/60s/IP (ratelimits), header bao mat (CSP, chan iframe, nosniff) cho trang + API, escape link Gmail (`360bdb4`)
- Khoi phuc luu noi dung thu (text+html) vao R2 - chi KHONG luu file dinh kem; gui lai thu trung tu bu ban R2 con thieu; trich-dan-lai chay theo dot (?tu=&so=) (`47a70e1`)
- Bo luu R2 (chi luu thong tin luong); ca moi: tim 30 ngay + khop danh muc Theo doi doi tra, da co ca moi thi ngung tim; tu ket thuc luong sau 30 ngay khong co thong tin; gan lai ban dem chi luong <=30 ngay; luong-list loc trang thai (`1f25cfe`)
- Sua nut Xuat CSV: a.click() bi comment nham (loi tu commit 0f64c71) (`3ddcf13`)

### 2026-10-08
- Chong trung thu trich dan: so them tieu de (truoc chi nguoi gui + 2 phut -> mat thu de xuat 13:48 khi co FW 13:50); /api/admin/trich-dan-lai tach lai trich dan tu R2; ten file CSV theo ngay VN (`0f64c71`)
- Ket thuc luong doi tra + gan ca doi thu cong tu DVBH + nhat ky thao tac (migration 0007); API luong-list; luong da ket thuc ngung truy van DVBH (`a79a6a8`)
- Lam gon noi dung thu de hien thi (gonThu.ts): bo bang de xuat dan phang, ghep bang khac thanh 'Tieu de: gia tri', bo chu ky; API tra noi_dung + tom_tat (`0d193e2`)
- API doi tac /api/partner/case tra them ca_moi (cho tab Luong mail tren DVBH) (`2be83d8`)
- Noi ca moi doi cho KH theo id_khach_hang: bang ca_moi, tu gan khi khop model, xac nhan tay tren bao cao (`8c89636`)
- Bao cao vong doi doi tra: dong bo Tranh chap doi may tu DVBH (3h/lan), ghep voi luong mail, doi soat, trang web bao cao (`9130141`)
- Lo trinh: DVBH v1.431 da deploy tab Luong mail (`69f7a26`)
- Yeu cau pipeline gui id_khach_hang; cap nhat lo trinh (`1da761e`)
- API doi tac GET /api/partner/case cho DVBH (tab Luong mail) (`8669041`)
- Moc Karofi tiep nhan phan anh + trang thai tiep_nhan (`23ac3ca`)
- De xuat dang 2: xin phe duyet ngay trong luong cu (khong co tieu de HO TRO) (`dc1cec7`)
- Moc sau duyet: giao xu ly, len SO, len DO + trang thai luong; endpoint tinh lai toan bo (`56c7f2e`)
- Apps Script ban 2: Gmail API + history (1 luot goi/mail), tranh het han muc GmailApp (`ec3d642`)
- Bo sung HTML cho thu da luu khi gui lai; Apps Script ghi nhat ky ro rang, cho khoa 60s (`c16a7ce`)
- Luong 3 lop: loc ten mien, tach thu trich dan, gan case DVBH theo ma/serial, moc de xuat/duyet, R2 toan van (`eaa5fd3`)
- Doi ten Worker thanh theodoidoimay (`3aba7a1`)
- thuky-mail: Worker nhan mail tu Gmail (Apps Script), gom luong theo Message-ID/References, D1 rieng (`167e0c1`)
