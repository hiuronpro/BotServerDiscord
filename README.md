# Overnight Group

Bot Discord dùng `discord.js` v14, Node.js và ES Modules để quản lý thông báo và phát âm thanh theo phiên riêng của từng server.

## Tính năng

- `/thongbao`: soạn, xem trước và gửi thông báo; `/setting`: phân quyền role và cấu hình kênh log.
- `/join`, `/play`, `/pause`, `/resume`, `/nowplaying`, `/queue`, `/skip`, `/remove`, `/clear`, `/volume`, `/stop`, `/leave`, `/help`: bot phát nhạc từ YouTube/SoundCloud và hỗ trợ link track Spotify bằng cách tìm bản tương ứng trên YouTube.
- Mỗi guild có voice connection, audio player và queue riêng. `/play` tự phát khi player đang rảnh, hoặc thêm bài nhạc vào queue khi đang phát.
- Log hoạt động thông báo được ghi ở `logs/announcement.log`; cấu hình server ở `data/guild-settings.json`.

## Yêu cầu

- Node.js 22.12 trở lên và npm (`@discordjs/voice` cần DAVE để kết nối voice Discord).
- FFmpeg cài riêng và có `ffmpeg.exe` trong `PATH`.
- yt-dlp cài riêng và có `yt-dlp.exe` trong `PATH`, hoặc cấu hình đường dẫn đầy đủ trong `YT_DLP_PATH`.
- Deno trong `PATH` để yt-dlp giải mã JavaScript của YouTube.
- Bot cần quyền trong server: **View Channel**, **Send Messages**, **Connect**, **Speak**; thêm **Embed Links** nếu gửi log dạng embed. Để bot tự lên làm diễn giả trong Stage Channel, cấp thêm quyền server **Mute Members**; đây là quyền Discord yêu cầu để bot tự bỏ trạng thái khán giả.

Lấy yt-dlp từ trang cài đặt/phát hành chính thức của dự án yt-dlp và FFmpeg từ trang tải chính thức hoặc bản build Windows được FFmpeg giới thiệu. Không tải executable từ nguồn không tin cậy. Trên Windows, kiểm tra cài đặt bằng:

```powershell
yt-dlp --version
ffmpeg -version
```

`@discordjs/voice` được ghim ở phiên bản hỗ trợ DAVE. Opus dùng fallback JavaScript `opusscript`; máy ít tài nguyên có thể cân nhắc cài codec native tương thích sau này.

### Railway

Với Railway dùng Nixpacks, build bật thêm Python provider, cài Python 3.12, Deno và FFmpeg; `requirements.txt` cài `yt-dlp[default]` vào virtualenv Nixpacks `/opt/venv`. `YT_DLP_PATH` được đặt rõ thành `/opt/venv/bin/yt-dlp`, tránh gọi bản yt-dlp từ Nix. Khi khởi động, bot in đường dẫn và phiên bản yt-dlp, Deno, FFmpeg; bot dừng trước khi đăng nhập Discord nếu executable yt-dlp không chạy hoặc không hỗ trợ `--js-runtimes`. `package.json` yêu cầu Node.js 22.12 trở lên. Để phát playlist Spotify, thêm `SPOTIFY_CLIENT_ID` và `SPOTIFY_CLIENT_SECRET` vào Variables của Railway; không commit hai giá trị này.

Để áp dụng trên Railway, commit và push `nixpacks.toml`, `requirements.txt` cùng code mới lên repository đang kết nối, xác nhận Railway dùng Nixpacks (không override bằng Dockerfile/custom start command), rồi **Redeploy** từ commit đó. Trong build log, xác nhận cài dependencies thành công và lệnh `/opt/venv/bin/yt-dlp --help` có `--js-runtimes`. Trong runtime log, xác nhận dòng `[AUDIO] yt-dlp executable=/opt/venv/bin/yt-dlp version=...`. Có thể giữ `YT_DLP_PATH` ở Variables mặc định do Nixpacks đặt; nếu đã tự đặt biến này sang giá trị khác, xóa override hoặc đặt lại `/opt/venv/bin/yt-dlp`. Nếu dùng Dockerfile/builder khác, cần cài `yt-dlp[default]`, Deno và FFmpeg trong image và đặt `YT_DLP_PATH` tới đúng executable.

Nếu YouTube vẫn báo `Sign in to confirm you're not a bot` sau khi Redeploy, lỗi thường do YouTube chặn hoặc giới hạn IP outbound của máy chủ. Đổi builder sang Nixpacks, cài lại Deno hoặc khởi động lại thường không đổi IP outbound của Railway. Hãy kiểm tra log và phiên bản yt-dlp; nếu yt-dlp đã mới nhất mà lỗi vẫn còn, chờ rồi thử lại hoặc liên hệ Railway về IP outbound. Có thể cần chuyển dịch vụ sang máy chủ/mạng khác có quyền truy cập phù hợp với điều khoản dịch vụ của YouTube.

Lỗi `no such option: --js-runtimes` là dấu hiệu bot đang gọi nhầm hoặc cũ executable yt-dlp; đọc dòng `[AUDIO]` để so đường dẫn/phiên bản với `/opt/venv/bin/yt-dlp`. Lỗi `No supported JavaScript runtime` hoặc log Deno `unavailable` là vấn đề Deno/PATH. Lỗi `Sign in to confirm you're not a bot`, HTTP 403/429, hoặc thông báo video không khả dụng xảy ra sau khi yt-dlp đã chạy được và là lỗi truy cập/giới hạn của YouTube, không phải lỗi phiên bản hay cú pháp tham số.

## Cài đặt và chạy trên Windows

1. Tạo Discord Application trong Developer Portal, thêm Bot và giữ `BOT_TOKEN` riêng tư. Cài bot vào server với scope `bot` và `applications.commands`; cấp quyền View Channel, Send Messages, Connect và Speak. Nếu muốn bot tự lên làm diễn giả trong Stage Channel, cấp thêm quyền server Mute Members.
2. Cài Node.js 22.12+, FFmpeg, yt-dlp và Deno; mở PowerShell mới để nạp `PATH`.
3. Trong thư mục dự án, cài dependency:
   ```powershell
   npm install
   ```
4. Tạo `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
5. Điền các biến:
   - `BOT_TOKEN`: token bot từ Discord Developer Portal.
   - `CLIENT_ID`: Application ID.
   - `GUILD_ID`: tùy chọn; khi deploy, xóa các lệnh riêng cũ của server này để tránh trùng với bộ lệnh toàn cục.
   - `YT_DLP_PATH`: mặc định `yt-dlp`; có thể đặt đường dẫn đầy đủ tới `yt-dlp.exe`.
   - `DENO_PATH`: mặc định `deno`; có thể đặt đường dẫn đầy đủ tới `deno.exe` nếu không có trong `PATH`.
   - `FFMPEG_PATH`: tùy chọn, đường dẫn đầy đủ tới `ffmpeg.exe`; thư mục chứa file sẽ được thêm vào `PATH`.
   - `SPOTIFY_CLIENT_ID` và `SPOTIFY_CLIENT_SECRET`: tùy chọn, lấy trong Spotify Developer Dashboard; cần cho playlist Spotify công khai. Spotify yêu cầu tài khoản sở hữu ứng dụng có gói Premium đang hoạt động để gọi API playlist; sau khi đổi gói, quyền API có thể mất vài giờ mới cập nhật. Không cần hai biến này cho link track Spotify đơn.
   - `MAX_QUEUE_SIZE`: số bài nhạc tối đa trong một phiên, mặc định `20` (tính cả bài đang phát).
   - `MAX_VIDEO_MINUTES`: thời lượng tối đa mỗi bài nhạc, mặc định `120` phút. Tên biến cũ được giữ để tương thích cấu hình hiện tại.
6. Đăng ký slash commands:
   ```powershell
   npm run deploy
   ```
7. Chạy bot:
   ```powershell
   npm start
   ```

`npm start` đăng ký/kiểm tra slash commands trước khi đăng nhập bot như hành vi hiện tại của dự án. Các lệnh chỉ được đăng ký toàn cục; Discord có thể cần thời gian cập nhật. Chỉ chạy **một instance** cho mỗi bot token.

## Player

- `/join`: bot vào voice channel hoặc Stage Channel của người gọi. Trên Stage, bot tự bỏ trạng thái khán giả để lên làm diễn giả; cần View Channel, Connect, Speak và quyền server Mute Members. Gọi lại ở channel khác sẽ chuyển bot có kiểm soát và dọn phiên/queue cũ.
- `/play link:<URL>`: tự đưa bot vào voice channel/Stage của người gọi rồi phát **nhạc/audio** từ track hoặc playlist YouTube/SoundCloud; playlist chỉ thêm các bài vừa với số chỗ còn trống trong queue. Trong lúc resolve link, lệnh báo bot đã vào voice và đang xử lý. Link Mix/Radio YouTube có kèm video sẽ phát video đó; YouTube không cho bot tải nguyên danh sách Mix/Radio nên link Mix không kèm video không hỗ trợ. Link track Spotify được đọc metadata công khai rồi tìm bản tương ứng trên YouTube. Playlist Spotify công khai cần Spotify Client ID/Secret và cũng được tìm từng track trên YouTube; kết quả có thể khác bản gốc. Playlist riêng tư, livestream, URL không hợp lệ và track vượt giới hạn không được phát; bài không lấy được metadata sẽ được bỏ qua và báo số lượng. yt-dlp đọc metadata trước, sau đó truyền audio stream theo luồng, không tải toàn bộ track vào RAM.
- `/pause` và `/resume`: tạm dừng/tiếp tục bài hiện tại.
- `/nowplaying`: hiển thị tiêu đề, nguồn, link, thời lượng và tiến độ.
- `/queue page:<số>`: xem bài đang phát và queue; mỗi trang tối đa 10 bài nhạc đang chờ.
- `/skip`: bỏ bài hiện tại và thử phát bài tiếp theo.
- `/remove position:<số>`: xóa bài đang chờ theo vị trí trong queue, tính từ 1.
- `/clear`: xóa bài chờ nhưng không ngắt bài đang phát.
- `/volume volume:<0-100>`: đặt mức âm lượng cho phiên voice.
- `/stop`: dừng bài đang phát nhưng giữ bot và queue trong voice channel.
- `/leave`: dừng audio, xóa queue, đóng voice connection và dọn tiến trình.
- `/help`: xem hướng dẫn nhanh.

Player hỗ trợ **âm thanh** từ YouTube và SoundCloud. Spotify không cung cấp luồng audio trực tiếp cho bot này; track/playlist Spotify chỉ dùng để lấy metadata và tìm bản tương ứng trên YouTube. Âm thanh thực tế do YouTube cung cấp, có thể không khớp hoàn toàn track gốc. Bot không truyền hình ảnh video. Chỉ phát nội dung bạn có quyền sử dụng và tuân thủ điều khoản của dịch vụ nguồn cùng luật áp dụng.

## Thông báo và cài đặt

- `/thongbao`: chọn kênh và tối đa năm role mention, nhập nội dung trong modal, xem trước rồi xác nhận gửi.
- `/setting them-role role:<search>` / `/setting go-role role:<search>`: cấp/gỡ quyền dùng bot cho role.
- `/setting kenh-log kenh:<search>`: chọn kênh log; `/setting xoa-log`: tắt log; `/setting xem`: xem cấu hình.
- Thành viên có role được cấp quyền hoặc là Administrator có thể dùng `/thongbao`.
- Kênh log cần View Channel và Send Messages. Nếu có Embed Links, log được gửi dạng embed; nếu không, bot dùng văn bản thường.

## Bảo mật và giới hạn

- Không commit `.env` hoặc token.
- Đường dẫn `/play` được giới hạn ở hostname và dạng link YouTube, SoundCloud, Spotify được hỗ trợ. Spotify playlist cần client credentials; không dùng cookies trình duyệt hay cơ chế vượt hạn chế tuổi/khu vực.
- yt-dlp/FFmpeg là executable bên ngoài, được cài riêng theo môi trường deploy; cần cập nhật chúng khi YouTube thay đổi.
- Queue và voice session lưu trong bộ nhớ, không được chia sẻ giữa nhiều tiến trình. Chỉ chạy một instance bot; restart sẽ xóa queue.
- Cần thử kết nối voice trong server Discord sau khi cấu hình quyền và executable; bot phát âm thanh, không phát hình ảnh video.

## Kiểm thử

```powershell
npm test
```

Các bài test hiện có kiểm tra URL track/playlist YouTube/SoundCloud/Spotify được phép/từ chối, phân loại lỗi extractor, thao tác queue và cấu hình slash commands.
