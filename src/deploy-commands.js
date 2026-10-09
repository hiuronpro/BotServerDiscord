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
].map((command) => command.toJSON());

export async function deployCommands() {
  if (!config.BOT_TOKEN || !config.CLIENT_ID) {
    throw new Error('Thiếu BOT_TOKEN hoặc CLIENT_ID trong file .env');
  }

  const rest = new REST({ version: '10' }).setToken(config.BOT_TOKEN);
  const globalRoute = Routes.applicationCommands(config.CLIENT_ID);
  await rest.put(globalRoute, { body: commands });

  if (config.GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID),
      { body: [] },
    );
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
