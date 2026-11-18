# Nguồn âm thanh (Sound Credits)

Dự án **Xâm Online** sử dụng bộ tổng hợp âm thanh thời gian thực bằng **Web Audio API** (`src/lib/sound.ts`), không phụ thuộc tệp âm thanh nhị phân bên ngoài:

- **Chia bài (`deal`)**: Chuỗi xung lọc dải (bandpass noise + triangle envelope) mô phỏng tiếng lướt lá bài trên mặt nỉ.
- **Chọn lá (`select`)**: Dao động sóng tam giác ngắn (1800 Hz → 900 Hz, 35 ms) mô phỏng tiếng chạm nhẹ thẻ bài.
- **Đánh bài (`play`)**: Kết hợp xung tạp âm lọc cao tần và âm trầm ấm (160 Hz → 65 Hz, 90 ms) mô phỏng tiếng đặt bài xuống bàn nỉ.
- **Bỏ lượt (`pass`)**: Âm lướt trầm (320 Hz → 180 Hz, 110 ms) nhẹ nhàng.
- **Tới lượt (`turn`)**: Chuông đôi thanh tao (659.25 Hz E5 → 880 Hz A5) báo hiệu đến lượt người chơi.
- **Sắp hết giờ (`tick`)**: Nhịp gõ ngắn (1000 Hz, 25 ms) khi đồng hồ đếm ngược còn ≤ 5 giây.
- **Thắng ván (`win`)**: Hợp âm trưởng rực rỡ (C5 – E5 – G5 – C6).
- **Kết thúc / Thua ván (`lose`)**: Hợp âm trầm nhẹ (E4 – C4 – A3).

Giấy phép: Toàn bộ mã tổng hợp âm thanh thuộc phạm vi công cộng (CC0 1.0 Universal).
