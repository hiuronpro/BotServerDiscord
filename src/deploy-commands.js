import {
  ApplicationIntegrationType,
  InteractionContextType,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config/env.js';

function playerCommand(name, description) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild);
}

const playerCommands = [
  playerCommand('join', 'Cho bot vào kênh thoại của bạn'),
  playerCommand('play', 'Phát track/playlist YouTube/SoundCloud; Spotify tìm trên YouTube')
    .addStringOption((option) => option
      .setName('link')
      .setDescription('Link track/playlist YouTube, SoundCloud hoặc Spotify')
      .setRequired(true)),
  playerCommand('pause', 'Tạm dừng bài đang phát'),
  playerCommand('resume', 'Tiếp tục bài đang tạm dừng'),
  playerCommand('nowplaying', 'Xem bài nhạc hiện đang phát'),
  playerCommand('queue', 'Xem queue phát của server')
    .addIntegerOption((option) => option
      .setName('page')
      .setDescription('Trang queue, mỗi trang tối đa 10 bài nhạc')
      .setMinValue(1)
      .setRequired(false)),
  playerCommand('skip', 'Bỏ qua bài đang phát'),
  playerCommand('remove', 'Xóa một bài nhạc khỏi queue')
    .addIntegerOption((option) => option
      .setName('position')
      .setDescription('Vị trí trong danh sách đang chờ, bắt đầu từ 1')
      .setMinValue(1)
      .setRequired(true)),
  playerCommand('clear', 'Xóa queue đang chờ, giữ bài hiện tại'),
  playerCommand('volume', 'Đặt âm lượng từ 0 đến 100')
    .addIntegerOption((option) => option
      .setName('volume')
      .setDescription('Mức âm lượng phần trăm')
      .setMinValue(0)
      .setMaxValue(100)
      .setRequired(true)),
  playerCommand('stop', 'Dừng bài hiện tại và giữ bot trong voice'),
  playerCommand('leave', 'Dừng phát và rời kênh thoại'),
  playerCommand('help', 'Xem trợ giúp bot phát nhạc'),
];

export const commands = [
  new SlashCommandBuilder()
    .setName('thongbao')
    .setDescription('Soạn và gửi thông báo trong server')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) => option
      .setName('kenh')
      .setDescription('Tìm kênh văn bản nhận thông báo')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption((option) => option
      .setName('role1')
      .setDescription('Tìm role mention thứ nhất')
      .setRequired(false)
      .setAutocomplete(true))
    .addStringOption((option) => option
      .setName('role2')
      .setDescription('Tìm role mention thứ hai')
      .setRequired(false)
      .setAutocomplete(true))
    .addStringOption((option) => option
      .setName('role3')
      .setDescription('Tìm role mention thứ ba')
      .setRequired(false)
      .setAutocomplete(true))
    .addStringOption((option) => option
      .setName('role4')
      .setDescription('Tìm role mention thứ tư')
      .setRequired(false)
      .setAutocomplete(true))
    .addStringOption((option) => option
      .setName('role5')
      .setDescription('Tìm role mention thứ năm')
      .setRequired(false)
      .setAutocomplete(true)),
  new SlashCommandBuilder()
    .setName('setting')
    .setDescription('Quản lý quyền và cấu hình bot cho server')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) => subcommand
      .setName('them-role')
      .setDescription('Cấp quyền dùng bot cho một role')
      .addStringOption((option) => option
        .setName('role')
        .setDescription('Tìm role cần cấp quyền')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('go-role')
      .setDescription('Gỡ quyền dùng bot khỏi một role')
      .addStringOption((option) => option
        .setName('role')
        .setDescription('Tìm role cần gỡ quyền')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('kenh-log')
      .setDescription('Chọn kênh ghi log thông báo')
      .addStringOption((option) => option
        .setName('kenh')
        .setDescription('Tìm kênh nhận log')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('xoa-log')
      .setDescription('Tắt log thông báo'))
    .addSubcommand((subcommand) => subcommand
      .setName('xem')
      .setDescription('Xem cấu hình hiện tại')),
  ...playerCommands,
].map((command) => command.toJSON());

export async function deployCommands() {
  if (!config.BOT_TOKEN || !config.CLIENT_ID) {
    throw new Error('Thiếu BOT_TOKEN hoặc CLIENT_ID trong file .env');
  }

  const rest = new REST({ version: '10' }).setToken(config.BOT_TOKEN);
  const globalRoute = Routes.applicationCommands(config.CLIENT_ID);
  await rest.put(globalRoute, { body: commands });

  if (config.GUILD_ID) {
    const guildRoute = Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID);
    await rest.put(guildRoute, { body: [] });
    const guildCommands = await rest.get(guildRoute);
    if (guildCommands.length) {
      throw new Error('Không thể xóa slash command riêng của server; các lệnh này có thể bị trùng với lệnh toàn cục.');
    }
  }

  const deployedCommands = await rest.get(globalRoute);
  const deployedNames = new Set(deployedCommands.map((command) => command.name));
  const missingCommands = commands
    .map((command) => command.name)
    .filter((name) => !deployedNames.has(name));
  if (missingCommands.length) {
    throw new Error(`Discord chưa xác nhận các slash command toàn cục: ${missingCommands.join(', ')}.`);
  }

}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await deployCommands();
  } catch (error) {
    console.error('Không thể deploy slash command:', error);
    process.exitCode = 1;
  }
}
