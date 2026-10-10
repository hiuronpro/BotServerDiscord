import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

const APPLICATION_DESCRIPTION = 'Bot Overnight Group: phát nhạc trong voice và hỗ trợ gửi thông báo cho server. Dùng /help để xem hướng dẫn.';

const SERVER_INVITE_URL = "https://discord.gg/J76tMQdCt3";
const DONATE_URL = "https://me.momo.vn/m8IDu1FgCmCXT1CAuGfO";

export async function ready(client) {
  console.info(
    `[${new Date().toISOString()}] ✅ Bot đã sẵn sàng: ${client.user.tag} | ${client.guilds.cache.size} server | ping ${client.ws.ping}ms`,
  );

  try {
    const application = await client.application.fetch();

    if (application.description !== APPLICATION_DESCRIPTION) {
      await application.edit({
        description: APPLICATION_DESCRIPTION,
      });
    }
  } catch (error) {
    console.warn("Không thể cập nhật phần giới thiệu bot:", error.message);
  }
}

export async function sendWelcomePanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("🌙 Chào mừng đến với Overnight Group")
    .setDescription([
      'Bot hỗ trợ phát nhạc trong voice và gửi thông báo trong server.',
      '',
      '**🎵 Phát nhạc**',
      'Vào kênh thoại rồi dùng `/play` và dán link YouTube, SoundCloud hoặc Spotify. Bot sẽ tự vào voice; dùng `/help` để xem lệnh tạm dừng, queue, bỏ qua và điều chỉnh âm lượng.',
      '',
      '**📢 Gửi thông báo**',
      'Quản trị viên dùng `/setting` để cấp quyền và chọn kênh log. Người được cấp quyền dùng `/thongbao` để soạn, xem trước và gửi thông báo.',
      '',
      '**Lưu ý:** Bot phát âm thanh, không phát hình ảnh video. Spotify được tìm bản tương ứng trên YouTube; kết quả có thể khác bản gốc.',
    ].join('\n'))
    .addFields({
      name: 'Bắt đầu nhanh',
      value: '`/play link:<URL>` · `/help` · `/thongbao`',
    })
    .setFooter({
      text: "OVERNIGHT GROUP • COMMUNITY",
    });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Tham gia cộng đồng")
      .setStyle(ButtonStyle.Link)
      .setURL(SERVER_INVITE_URL),

    new ButtonBuilder()
      .setLabel("Donate")
      .setStyle(ButtonStyle.Link)
      .setURL(DONATE_URL),
  );

  return channel.send({
    embeds: [embed],
    components: [buttons],
  });
}
