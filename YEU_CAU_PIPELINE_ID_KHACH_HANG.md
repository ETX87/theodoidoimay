# Yêu cầu: pipeline QuickSight gửi thêm "ID khách hàng" sang DVBH

Ngày: 2026-10-08 · Liên quan: báo cáo vòng đời đổi trả (hệ theodoidoimay), DVBH migration 0127.

## Cần làm

Trong mỗi dòng case gửi lên `POST https://dvbh.dichvu3t.workers.dev/api/external-import/...` (luồng import tự động
hiện có), **thêm 1 key**:

| Key gửi lên | Lấy từ cột QuickSight | Kiểu | Ghi chú |
|---|---|---|---|
| `id_khach_hang` | `ID khách hàng` | chuỗi | Gửi nguyên văn; rỗng thì gửi `""` hoặc bỏ key |

- Key là **tên cột DB** (`id_khach_hang`), giống cách đang gửi `muc_do`, `tinh_moi`… (nhóm `OPTIONAL_FIELDS`).
- Dòng **không có key** thì DVBH giữ nguyên giá trị cũ (không xoá) — nên nguồn Odoo (chưa có cột này) không bị ảnh hưởng.
- **Chỉ gửi sau khi DVBH đã deploy migration 0127** (cột chưa tồn tại thì import sẽ lỗi).

## Ảnh hưởng 1 lần

Lần đầu gửi, mã băm thay đổi (`crm_hash`) của các case có ID khách hàng sẽ đổi → các case đó được ghi đè **1 lần**
(lượt import đó nặng hơn bình thường). Các lần sau trở lại bình thường.

## Dùng để làm gì

Nối **ca mới mở để đổi máy cho khách** với **ca gốc** trong báo cáo đổi trả. Chốt nghiệp vụ: chỉ nối theo ID khách hàng,
**không** tra theo số điện thoại.
