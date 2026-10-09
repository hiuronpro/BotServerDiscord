import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

const APPLICATION_DESCRIPTION = ["Overnight Group"].join("\n");

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
    .setTitle("OVERNIGHT GROUP")
    .setDescription([].join("\n"))
    .setFooter({
      text: "OVERNIGHT GROUP • COMMUNITY",
    });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Tham gia máy chủ")
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
