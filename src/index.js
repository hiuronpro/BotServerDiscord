import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config/env.js';
import { deployCommands } from './deploy-commands.js';
import { interactionCreate } from './handlers/interactionCreate.js';
import { ready } from './handlers/ready.js';
import { ensureDataFiles } from './services/settingsService.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async () => {
  await ready(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await interactionCreate(interaction);
  } catch (error) {
    console.error('Lỗi khi xử lý interaction:', error);

    if (interaction.isRepliable()) {
      await interaction.reply({
        content: 'Đã xảy ra lỗi khi xử lý yêu cầu. Vui lòng thử lại sau.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => undefined);
    }
  }
});

try {
  ensureDataFiles();
  await deployCommands();
  await client.login(config.BOT_TOKEN);
} catch (error) {
  console.error('Không thể khởi động bot:', error.message);
  process.exit(1);
}
