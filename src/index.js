import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { delimiter, dirname } from 'node:path';
import { config } from './config/env.js';
import { deployCommands } from './deploy-commands.js';
import { interactionCreate } from './handlers/interactionCreate.js';
import { ready } from './handlers/ready.js';
import { shutdownPlayer } from './services/playerService.js';
import { ensureDataFiles } from './services/settingsService.js';
import { terminateAudioSourceProcesses, verifyAudioExecutables } from './services/audioSourceService.js';

if (config.FFMPEG_PATH) {
  process.env.PATH = `${dirname(config.FFMPEG_PATH)}${delimiter}${process.env.PATH || ''}`;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
let duplicateInteractionWarningLogged = false;
let shuttingDown = false;

client.once(Events.ClientReady, async () => {
  await ready(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await interactionCreate(interaction);
  } catch (error) {
    if (error?.code === 10062 || error?.code === 40060) {
      if (error.code === 40060 && !duplicateInteractionWarningLogged) {
        console.warn('Interaction đã được phản hồi ở nơi khác. Hãy đảm bảo chỉ chạy một tiến trình bot.');
        duplicateInteractionWarningLogged = true;
      }
      return;
    }

    console.error('Lỗi khi xử lý interaction:', error);

    if (interaction.isRepliable() && interaction.deferred) {
      try {
        await interaction.editReply({
          content: 'Đã xảy ra lỗi khi xử lý yêu cầu. Vui lòng thử lại sau.',
          embeds: [],
          components: [],
        });
      } catch (replyError) {
        if (replyError?.code === 10062 || replyError?.code === 40060) {
          return;
        }
        console.error('Không thể gửi thông báo lỗi cho interaction:', replyError);
      }
    } else if (interaction.isRepliable() && !interaction.replied) {
      try {
        await interaction.reply({
          content: 'Đã xảy ra lỗi khi xử lý yêu cầu. Vui lòng thử lại sau.',
          flags: MessageFlags.Ephemeral,
        });
      } catch (replyError) {
        if (replyError?.code === 10062 || replyError?.code === 40060) return;
        console.error('Không thể gửi thông báo lỗi cho interaction:', replyError);
      }
    }
  }
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Shutting down Discord bot after ${signal}.`);
  shutdownPlayer();
  terminateAudioSourceProcesses();
  client.destroy();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT').catch((error) => {
    console.error('Graceful shutdown failed:', error);
    process.exitCode = 1;
  });
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM').catch((error) => {
    console.error('Graceful shutdown failed:', error);
    process.exitCode = 1;
  });
});

try {
  ensureDataFiles();
  await verifyAudioExecutables();
  await deployCommands();
  await client.login(config.BOT_TOKEN);
} catch (error) {
  console.error('Không thể khởi động bot:', error.message);
  process.exit(1);
}
