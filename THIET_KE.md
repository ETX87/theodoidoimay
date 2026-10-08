# Thiết kế: Theo dõi luồng đổi trả (theodoidoimay)

Cập nhật: 2026-10-08. App riêng `theodoidoimay` (https://theodoidoimay.dichvu3t.workers.dev),
nối dữ liệu với DVBH và App Khiếu nại (`tiepnhan`). Không sửa dữ liệu của hai app kia.

## 1. Luồng nghiệp vụ thật (rút ra từ mail demo case 1347322)

```
Karofi (CV giải quyết khiếu nại, @karofi.vn)
  └─ Mail "HỖ TRỢ ĐỔI MÁY: <KH>_<SĐT>_<địa chỉ>_<model>_<serial>_<lỗi>_<Mã case>"
     kèm bảng 22 trường (Hãng, BP đổi, Khách hàng, Model, Số Serial, Chính sách, Lý do đổi, Mã Yêu Cầu...)
        → gửi TBP 3T (@dichvu3t.com), CC các bên
  └─ TBP 3T trả lời "Anh đồng ý thu hồi/đổi..."      ← mốc DUYỆT
  └─ (mở ca mới để đổi cho KH trên CRM/Odoo → về DVBH qua QuickSight)
  └─ ca mới hoàn thành                                 ← mốc ĐỔI XONG
```

Mã ở cuối tiêu đề = `case_dvbh.id`: dạng 7 số (CRM smarthiz) hoặc `SC` + số (Odoo happinno).
Đã đối chiếu 5/5 mail demo khớp DVBH (1 mail không có mã → khớp theo serial).

## 2. Thu mail

- CC `theodoidoimay@gmail.com` ngay từ mail đầu tiên (FW sau thì vẫn khôi phục được nhờ phần trích dẫn).
- Google Apps Script quét Gmail mỗi 5 phút → `POST /api/ingest` (header `X-Ingest-Key`).
- Mỗi mail FW/RE chứa chuỗi thư cũ dạng Outlook (`From:/Sent:/To:/Cc:/Subject:`) → tách thành các
  "thư trích dẫn" (`nguon = trich_dan`) để biết **ai mở luồng, lúc nào**. Khi sau này thư thật
  (`nguon = gmail`) của cùng người gửi, lệch ≤ 2 phút xuất hiện → thay thế bản trích dẫn.

## 3. Lưu trữ 3 lớp (đã chốt)

| Lớp | Điều kiện | Lưu | Thời hạn |
|---|---|---|---|
| A. Bỏ qua | Không có người gửi/nhận thuộc `dichvu3t.com`, `karofi.vn` | Bảng `bo_qua`: gmail_id, người gửi, tiêu đề, ngày, lý do | Tự xoá sau 90 ngày |
| B. Chưa gắn case | Đúng tên miền, chưa xác định được case DVBH | Đầy đủ, `match_status ≠ da_gan` | Lâu dài |
| C. Đã gắn case | Có mã case / serial khớp DVBH | Đầy đủ | Lâu dài |

- D1 (`thuky-mail-db`): thông tin tra cứu + phần nội dung mới của thư (`body_new`).
- R2 (`theodoidoimay-thu`): toàn văn text + HTML từng thư (`thu/<gmail_id>.json`).
- File đính kèm: chỉ lưu tên/dung lượng/loại; mở file qua link Gmail (`gmail_id`).

`match_status` của luồng: `da_gan` | `chua_gan` | `nhieu_ung_vien` (1 serial ra nhiều case) |
`cho_dvbh` (có mã nhưng DVBH chưa có case — QuickSight về trễ).
Cron hằng đêm thử gắn lại các luồng chưa `da_gan` và xoá `bo_qua` quá 90 ngày.

## 4. Gom luồng (thứ tự ưu tiên)

1. Mã case DVBH ở cuối tiêu đề, hoặc trường "Mã Yêu Cầu" trong bảng đề xuất → 1 luồng / 1 case DVBH.
2. Header `In-Reply-To` / `References` trỏ tới thư đã lưu.
3. Cùng luồng Gmail (`threadId`).
4. Cùng serial `SN…` với luồng có hoạt động trong 90 ngày.
5. Không khớp → luồng mới (`chua_gan`).

Tra DVBH: theo `id`, nếu không có thì theo `seri_san_pham` (so cả chữ hoa và chữ thường, có index).

## 5. Nhận diện mốc

| Mốc | Quy tắc hiện tại (sẽ tinh chỉnh khi có thêm mail thật) |
|---|---|
| Đề xuất đổi | Thư có tiêu đề bắt đầu `HỖ TRỢ …` không có tiền tố RE/FW, hoặc chứa bảng có cột "Mã Yêu Cầu" |
| Đề xuất (bổ sung) | Người gửi ngoài 3T và **người nhận (To) có @dichvu3t.com** — thư siêu thị báo hàng lỗi gửi Karofi là *điểm phát sinh*, không phải đề xuất |
| Duyệt | Thư của `@dichvu3t.com` sau thư đề xuất, nội dung mới (đã bỏ dấu) có "đồng ý / đã duyệt", không có "không/chưa đồng ý", không phải câu nhờ/xin duyệt |

Mốc duyệt tự động chỉ là **gợi ý**; người dùng xác nhận/sửa trên báo cáo.

Quan sát từ mail demo (để làm mốc 6): sau mail duyệt, Karofi gửi "Theo mail phê duyệt..." và
"Em đã lên SO thu hồi, đổi mới cho NPP: <số SO>" → có thể nhận diện mốc **lên SO đổi** từ mail.

## 6. Kết nối hệ thống khác

- **DVBH** (`dvbh-db-smarttrade`) và **Khiếu nại** (`khieu-nai-db`): gắn D1 binding **chỉ đọc theo quy ước**
  (chỉ `SELECT` theo khoá có index, gom trong 1 module), không cần sửa/deploy hai app kia ở giai đoạn đầu.
- **LADA**: hệ thống song song; hiển thị `id_lada` / `id_lada_phat_sinh` từ Khiếu nại nếu có, không dùng làm khoá.
- **ID khách hàng**: khoá duy nhất để nối ca mới (đổi cho KH) với ca gốc — **không tra theo SĐT**.
  QuickSight đã có cột "ID khách hàng" → cần thêm cột `id_khach_hang` vào `case_dvbh` + `COLUMN_MAP`.
  Odoo chưa có cột này → ca Odoo nối qua Khiếu nại hoặc gắn tay.
- Hiển thị trong DVBH: tab "Luồng mail" trong chi tiết case, gọi API theodoidoimay (Service Binding).

## 7. Hồ sơ đổi trả & báo cáo vòng đời

Khoá hồ sơ = case DVBH gốc. Hồ sơ có thể bắt đầu từ **bất kỳ nguồn nào** (mail, khiếu nại, giải trình DVBH),
vì luồng mail có thể bị sót → đối soát chéo để phát hiện hồ sơ thiếu mail.

| # | Mốc | Nguồn |
|---|---|---|
| 1 | Phát sinh nghi ngờ đổi máy | DVBH case gốc / giải trình |
| 2 | Tiếp nhận khiếu nại/phản ánh | Khiếu nại `ngay_tiep_nhan`, `id_crm_karofi` |
| 3 | Nhật ký xử lý | `khieu_nai_tien_trinh`, DVBH `giai_trinh` |
| 4 | Mail đề xuất đổi trả | theodoidoimay |
| 5 | Duyệt đổi trả | theodoidoimay (mail TBP) / Khiếu nại `ma_duyet_doi_linh_kien` |
| 6 | Mở ca mới đổi cho KH | DVBH case mới cùng `id_khach_hang` sau mốc 5 |
| 7 | Đổi trả thành công | DVBH case mới hoàn thành / Khiếu nại `ket_qua_doi_may`, `ngay_dong_doi_may` |

Báo cáo: thời gian giữa các mốc, hồ sơ kẹt theo mốc, tỷ lệ duyệt, theo hãng/khu vực/KTV/đại lý,
danh sách đối soát (có khiếu nại đổi máy nhưng không có mail, có mail nhưng không có khiếu nại...).

## 8. Lộ trình

1. ✅ Thu mail Gmail → Worker → D1.
2. ✅ Lọc tên miền + lưu 3 lớp + R2 + tách thư trích dẫn + nhận diện mã case/serial + tra DVBH + mốc đề xuất/duyệt.
3. ✅ Cron đối soát đêm 02:00 (gắn lại, dọn `bo_qua`) — đã có khung, sẽ mở rộng khi nối Khiếu nại.
4. DVBH: thêm cột `id_khach_hang` (QuickSight) + tab "Luồng mail" (Service Binding) — xem trước khi deploy.
5. Nối Khiếu nại + hồ sơ đổi trả 7 mốc + báo cáo.
