LETMECOOK · SUNNY AI LOCAL

Website: http://localhost:9401
Sunny: http://localhost:9401/sunny
Supabase Studio: http://localhost:56423
AI status: http://localhost:9401/api/ai/status

Đã giữ LetMeCook là sản phẩm nấu ăn. Sunny hiểu yêu cầu Việt/Anh,
nhận diện nguyên liệu từ ảnh, yêu cầu người dùng kiểm tra/xác nhận,
lọc tất cả điều kiện đã hiểu và xếp hạng công thức có thật trong DB.
Kết quả có ảnh gốc local, giải thích điều kiện phù hợp và link nguồn.
Không gọi API OpenAI; không cần OPENAI_API_KEY.

Mô hình đã cài trên máy:
  qwen3:8b        — phân tích yêu cầu thành JSON có kiểm tra
  qwen3-vl:4b-instruct     — nhận diện ảnh; kết quả phải xác nhận
  all-MiniLM-L6-v2 — xếp hạng semantic và gợi ý (CPU)
Ollama hiện có trên host: http://127.0.0.1:11434.
LLM dùng RTX 3080/CUDA; thiết bị không cần đưa vào container ứng dụng.
GPU chỉ tính toán khi có inference; model đang nạp VRAM có thể vẫn idle.
Model weights không nằm trong gói mã nguồn/dataset, được Ollama giữ riêng.

Khởi động lại/fresh install trong thư mục có quyền ghi:
  bash deploy/local-up.sh
Yêu cầu Docker Compose, Supabase CLI, Python3, curl, Ollama đang chạy local.
local-ai-setup.sh chỉ tải model thiếu từ registry Ollama chính thức.
Lần đầu MiniLM có thể tải pretrained weights và tạo cache trên volume.
Mã nguồn không có bước fine-tuning; không tuyên bố model được train từ dataset.
Cold start hoặc đổi model ảnh/text có thể lâu hơn warm request.

Cấu hình CPU đã đo trên Xeon 52 core/104 luồng: OMP_NUM_THREADS mặc định16,
Torch inter-op1. Có thể override OMP_NUM_THREADS trong khoảng1–24 và restart
worker; không đổi thread pool giữa request. MKL mặc định16, tokenizer không
chạy thêm pool song song. Gunicorn vẫn1 process/8 HTTP threads trong Docker;
Whisper CPU/int8 vẫn2 threads, num_workers1. Không đổi Ollama daemon/keep_alive5m.
Đo lại2 so với16 threads (5 batch repeats): encode32 recipe median1019,6→309,6ms
(3,29x), encode128 recipe3733,6→1017,7ms (3,67x), query8,25→6,66ms (1,24x).
Đây là warm encode benchmark, không phải thời gian toàn bộ request/Sunny.
Embedding cosine gần1, sai lệch tuyệt đối tối đa1,05e-7. Batch dùng dữ liệu
combined_text thật, model local có sẵn; không tải hoặc tạo lại embedding cache.

Container LetMeCook chạy UID/GID 1005:1005 — letmecoook trên máy này.
Ba service app + Supabase bind loopback; đây là triển khai local/private.
Ảnh người dùng đưa vào Sunny được giải mã, bỏ EXIF, giảm kích thước để
inference; không ghi file, không lưu prompt/ảnh vào database/log ứng dụng.
Tính năng tìm kiếm mới chỉ áp dụng điều kiện từ yêu cầu và ảnh đã xác nhận;
profile dietary/allergy vẫn được áp dụng trong gợi ý cá nhân sau đăng nhập.
Cancel trên UI dừng chờ phản hồi; inference đã gửi có thể tiếp tục ngắn hạn.
Ảnh/ingredient list không chứng minh an toàn dị ứng hoặc nhiễm chéo.

RPC save_recipe giữ recipe/ingredients/tags trong cùng transaction; quyền
ghi trực tiếp các trường ranking/provenance đã được thu hẹp. Lỗi giữa bước
không để lại công thức dở dang. Direct Supabase RLS và Java ownership guard
đều được kiểm tra. Full cache rebuild yêu cầu app_metadata.role=admin,
do server quản lý; user_metadata không cấp quyền admin.

10.000 công thức và 10.000 ảnh gốc local giữ nguyên. JSONL frozen vẫn giữ
evidence gốc; importer đọc nhiều suitableForDiet URIs để khôi phục đầy đủ
vegan/gluten-free/vegetarian/low-fat/low-calorie. Metadata source/image ghi
all rights reserved; chưa có tài liệu chứng minh quyền tái phân phối thương mại.
Repo không có LICENSE trong phần đã kiểm tra. SRS đầy đủ và UI01–UI23 chưa
được cung cấp; báo cáo chỉ đối chiếu phần trích trong Deviation Report.

Các API được kiểm tra: /api/ai/status, /api/ai/search, /api/ai/vision;
legacy /api/opencv/* chuyển sang local service để giữ tương thích.
Photo: JPG/PNG/WebP <=5 MB và <=20 MP, server kiểm tra bytes thật.
AI: 1 job model đồng thời; job khác nhận429 để retry; model lỗi trả503/502.

Dừng app và giữ volumes:
  docker compose --env-file deploy/.env.local -f deploy/compose.yaml stop
