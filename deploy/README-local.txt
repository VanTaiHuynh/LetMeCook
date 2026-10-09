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
  qwen3-embedding:0.6b — hybrid dense/BM25 + RRF/MMR (GPU embedding)
  all-MiniLM-L6-v2 — compatibility cache (CPU, pinned local revision)
Ollama hiện có trên host: http://127.0.0.1:11434.
LLM dùng RTX 3080/CUDA; thiết bị không cần đưa vào container ứng dụng.
GPU chỉ tính toán khi có inference; model đang nạp VRAM có thể vẫn idle.
Model weights không nằm trong gói mã nguồn/dataset, được Ollama giữ riêng.

Khởi động lại/fresh install trong thư mục có quyền ghi:
  bash deploy/local-up.sh
Yêu cầu Docker Compose, Supabase CLI, Python3, curl, Ollama đang chạy local.
local-ai-setup.sh chỉ tải model thiếu từ registry Ollama chính thức.
Runtime MiniLM chỉ dùng weights đã provision local; không tự tải model.
Startup giữ index hợp lệ. Với volume trống, chạy explicit build theo
docs/product/release-2026-10-08.md trước khi chờ recommendation readiness.
Mã nguồn không có bước fine-tuning; không tuyên bố model được train từ dataset.
Cold start hoặc đổi model ảnh/text có thể lâu hơn warm request.

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
