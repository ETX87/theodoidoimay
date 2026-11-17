# Tổng hợp logic — Thư ký mail đổi máy (`theodoidoimay`)

> Mô tả logic **đang chạy thật** (theo code + `THIET_KE.md` tới 17/11/2026). Logic đổi thì sửa đè đúng mục; lịch sử ở
> `nhat_ky_lam_viec.md`. Không ghi tài khoản, mật khẩu, khoá. Hệ này là Worker xử lý mail + trang báo cáo, không có app
> React nên không có SRS (theo nguyên tắc chung).

## 1. Hệ thống là gì

- Cloudflare Worker `theodoidoimay` theo dõi **luồng mail đề xuất / duyệt đổi máy** giữa Karofi và 3T, ghép với case DVBH
  để dựng **hồ sơ vòng đời đổi trả** và báo cáo thời gian từng bước.
- Lưu trữ: D1 (thông tin tra cứu + phần nội dung mới của thư), R2 (toàn văn text + HTML từng thư). File đính kèm KHÔNG lưu
  (chỉ tên / dung lượng; mở bản gốc qua Gmail).
- Trang báo cáo web đăng nhập bằng mật khẩu ứng dụng.

## 2. Thu mail

- Hộp thư theo dõi được CC ngay từ thư đầu; Google Apps Script quét Gmail **mỗi 5 phút** → `POST /api/ingest`.
- Thư FW/RE có chuỗi trích dẫn kiểu Outlook → tách thành "thư trích dẫn" để biết ai mở luồng, lúc nào; khi thư thật của
  cùng người gửi (lệch ≤ 2 phút) xuất hiện thì thay bản trích dẫn.

### Lưu 3 lớp

| Lớp | Điều kiện | Lưu |
|---|---|---|
| A. Bỏ qua | Không có người gửi / nhận thuộc tên miền 3T hoặc Karofi | Chỉ thông tin tối thiểu, tự xoá sau 90 ngày |
| B. Chưa gắn case | Đúng tên miền, chưa xác định case DVBH | Đầy đủ |
| C. Đã gắn case | Có mã case / serial khớp DVBH | Đầy đủ |

Trạng thái gắn (`match_status`): `da_gan` / `chua_gan` / `nhieu_ung_vien` (1 serial ra nhiều case) / `cho_dvbh` (có mã nhưng
DVBH chưa có case).

## 3. Gom luồng (thứ tự ưu tiên)

1. Mã case DVBH ở cuối tiêu đề (7 số CRM hoặc `SC` + số Odoo) hoặc trường "Mã Yêu Cầu" trong bảng đề xuất.
2. Header `In-Reply-To` / `References` trỏ tới thư đã lưu.
3. Cùng luồng Gmail (`threadId`).
4. Cùng serial `SN…` với luồng có hoạt động trong 90 ngày.
5. Không khớp → luồng mới `chua_gan`.

## 4. Nhận diện mốc → trạng thái luồng

`phat_sinh` → `tiep_nhan` → `cho_duyet` → `da_duyet` → `giao_xu_ly` → `da_len_so` → `da_len_do`

- Đề xuất đổi: tiêu đề bắt đầu "HỖ TRỢ …" (không RE/FW) hoặc có bảng cột "Mã Yêu Cầu"; hoặc thư ngoài 3T gửi tới 3T xin phê duyệt.
- Duyệt: thư của 3T sau thư đề xuất có "đồng ý / đã duyệt" (không có "không / chưa đồng ý"). Chỉ là **gợi ý**, người dùng xác nhận / sửa.
- Karofi tiếp nhận, giao xử lý, lên SO / lên DO: theo cụm từ trong thư của Karofi; SO/DO chỉ ghi thời gian, không lưu số.
- Đổi quy tắc → `POST /api/admin/tinh-lai` áp dụng lại cho toàn bộ thư đã lưu (không cần quét lại Gmail). Chi tiết quy tắc: `THIET_KE.md` §5.

## 5. Hồ sơ đổi trả (khoá = case DVBH gốc)

| # | Mốc | Nguồn |
|---|---|---|
| 1 | Yêu cầu đổi / phát sinh nghi ngờ | DVBH (module Tranh chấp, khiếu nại: phân loại "KH đòi đổi máy" / "Đổi trả") |
| 2 | CSKH xử lý | DVBH |
| 3–5b | Tiếp nhận → đề xuất → duyệt → giao xử lý → SO → DO | Mail (hệ này) |
| 6 | Ca mới đổi cho KH | DVBH: case cùng **ID khách hàng** (không tra SĐT), tiếp nhận trong 30 ngày sau duyệt, khớp danh mục "Theo dõi đổi trả" của DVBH |
| 7 | Đổi trả thành công | Ca mới hoàn thành |

- Ca mới: tự gán khi đúng 1 ứng viên khớp model; còn lại vào tab "Ca mới cần xác nhận" để người dùng chọn / xác nhận "không có ca mới".
- Báo cáo: thời gian trung bình từng bước, hồ sơ kẹt > 3 ngày, đối soát (có yêu cầu đổi chưa có mail, có mail chưa có hồ sơ,
  đã duyệt mà DVBH chưa cập nhật, duyệt > 7 ngày chưa có ca mới, luồng chưa gắn case), xuất CSV.

## 6. Kết thúc luồng

- Luồng đã kết thúc không còn truy vấn DVBH. Nhật ký `nhat_ky` ghi ai làm gì ("Hệ thống" khi tự động).
- Tự kết thúc (cron 02:00): đã lên SO (hoặc DO) quá 3 ngày → "Tự động đóng do KRF đã lên đơn trả"; không có thông tin mới 30 ngày
  → "Tự động kết thúc… không tìm thấy thông tin trong 30 ngày". Ca từng được người dùng "mở lại" thì không tự đóng theo SO/DO.
- DVBH thao tác qua API đối tác: kết thúc / mở lại / gán ca mới, danh sách luồng (tab "Luồng duyệt đổi trả" bên DVBH).

## 7. Kết nối hệ khác

| Hệ | Cách nối | Ghi chú |
|---|---|---|
| DVBH | D1 binding chỉ đọc (SELECT theo khoá có index) | Tra case theo `id`, không có thì theo serial |
| DVBH → hệ này | Service Binding, `GET /api/partner/case`, `/api/partner/luong-list`, `POST /api/partner/doi-tra/*` | Tab "Luồng mail" / "Luồng duyệt đổi trả" trong DVBH |
| App Khiếu nại | D1 binding chỉ đọc | Chưa dùng (nhánh đổi máy bên đó gần như không có dữ liệu) |
| Pipeline QuickSight → DVBH | cột `id_khach_hang` | Khoá nối ca mới với ca gốc (`YEU_CAU_PIPELINE_ID_KHACH_HANG.md`) |

## 8. Lịch chạy tự động

| Lịch (UTC) | Việc |
|---|---|
| `0 */3 * * *` (3 giờ/lần) | Đồng bộ hồ sơ đổi máy từ DVBH (`tc_doi_may`), tìm ca mới |
| `0 19 * * *` (02:00 VN) | Gắn lại luồng chưa gắn (≤ 30 ngày), dọn lớp "Bỏ qua" > 90 ngày, tự kết thúc luồng |

## 9. Tài liệu liên quan

`THIET_KE.md` (thiết kế chi tiết + lộ trình), `YEU_CAU_PIPELINE_ID_KHACH_HANG.md`, `nhat_ky_lam_viec.md`.
