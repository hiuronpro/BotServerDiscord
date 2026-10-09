import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { canManageSettings } from '../services/permissionService.js';
import { loadGuildSettings, saveGuildSettings } from '../services/settingsService.js';
import { APP_ACCENT } from '../utils/constants.js';

const OPTIONS_PER_MENU = 25;
const ITEMS_PER_PAGE = 100;
const LOG_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

export function getSettingsGuildRoles(guild) {
  return [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name));
}

export function getSettingsGuildTextChannels(guild) {
  return [...guild.channels.cache.values()]
    .filter((channel) => LOG_CHANNEL_TYPES.has(channel.type))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildRoleStatusFields(guild, allowedRoleIds) {
  const allowedRoles = new Set(allowedRoleIds);
  const roles = getSettingsGuildRoles(guild);
  const lines = roles.map((role) => `${allowedRoles.has(role.id) ? '✅' : '▫️'} ${role.name}`);

  if (!lines.length) {
    return [{
      name: '🎭 Role trong server',
      value: 'Server chưa có role tùy chỉnh.',
      inline: false,
    }];
  }

  const fields = [];
  let chunk = [];
  let chunkLength = 0;
  for (const line of lines) {
    if (chunk.length && chunkLength + line.length + 1 > 1000) {
      fields.push({
        name: fields.length ? '🎭 Role trong server (tiếp)' : `🎭 Tất cả role trong server (${roles.length})`,
        value: chunk.join('\n'),
        inline: false,
      });
      chunk = [];
      chunkLength = 0;
    }
    chunk.push(line);
    chunkLength += line.length + 1;
  }
  if (chunk.length) {
    fields.push({
      name: fields.length ? '🎭 Role trong server (tiếp)' : `🎭 Tất cả role trong server (${roles.length})`,
      value: chunk.join('\n'),
      inline: false,
    });
  }
  return fields;
}

function buildSettingsDescription(guild, screen) {
  const roleCount = getSettingsGuildRoles(guild).length;
  const channelCount = getSettingsGuildTextChannels(guild).length;
  const rolePageCount = Math.max(1, Math.ceil(roleCount / ITEMS_PER_PAGE));
  const channelPageCount = Math.max(1, Math.ceil(channelCount / ITEMS_PER_PAGE));
  const screenInstructions = {
    roles: `Có ${roleCount} role, chia thành các nhóm chọn ngay trên màn hình${rolePageCount > 1 ? ` (trang 1/${rolePageCount})` : ''}. Tích/bỏ tích trực tiếp để cấp hoặc gỡ quyền; thay đổi được lưu ngay.`,
    log: `Có ${channelCount} kênh văn bản, chia thành các nhóm chọn ngay trên màn hình${channelPageCount > 1 ? ` (trang 1/${channelPageCount})` : ''}. Chọn kênh để lưu log người gửi và kênh nhận thông báo.`,
  };

  return [
    `Server: **${guild.name}**`,
    'Chỉ quản lý role được phép sử dụng bot. Thành viên có ít nhất một role được cấp quyền có thể dùng `/thongbao`. Administrator luôn có quyền quản trị.',
    screenInstructions[screen] || 'Dùng Autocomplete ngay trên lệnh để thêm/gỡ role hoặc chọn kênh log. `/setting xoa-log` sẽ tắt log.',
  ].join('\n\n');
}

export function buildSettingsEmbed(guild, settings, screen = 'main') {
  const allowedRoles = settings.allowedRoles.filter((roleId) => guild.roles.cache.has(roleId));
  const logChannel = settings.logChannelId ? guild.channels.cache.get(settings.logChannelId) : null;

  return new EmbedBuilder()
    .setColor(APP_ACCENT)
    .setTitle('⚙️ Cài đặt bot')
    .setDescription(buildSettingsDescription(guild, screen))
    .addFields(
      {
        name: `✅ Đang có quyền: ${allowedRoles.length} role`,
        value: '✅ = được phép dùng bot · ▫️ = chưa được cấp quyền.',
        inline: false,
      },
      ...buildRoleStatusFields(guild, allowedRoles),
      {
        name: '🧾 Kênh log thông báo',
        value: logChannel ? `<#${logChannel.id}>` : 'Chưa thiết lập',
        inline: false,
      },
    )
    .setFooter({
      text: 'Các thay đổi được lưu ngay sau khi chọn.',
    })
    .setTimestamp(new Date());
}

function buildPageControls(screen, page, pageCount) {
  const controls = [
    new ButtonBuilder()
      .setCustomId(`settings_${screen}_back`)
      .setLabel('↩ Quay lại')
      .setStyle(ButtonStyle.Secondary),
  ];

  if (pageCount > 1) {
    controls.unshift(
      new ButtonBuilder()
        .setCustomId(`settings_${screen}_page:${page - 1}`)
        .setLabel('◀ Trước')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`settings_${screen}_page:${page + 1}`)
        .setLabel('Sau ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount - 1),
    );
  }

  return new ActionRowBuilder().addComponents(controls);
}

function buildRoleSelectionRows(guild, settings, page = 0) {
  const roles = getSettingsGuildRoles(guild);
  const pageCount = Math.max(1, Math.ceil(roles.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(Math.max(page, 0), pageCount - 1);
  const pageRoles = roles.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);
  const rows = [];

  for (let start = 0; start < pageRoles.length; start += OPTIONS_PER_MENU) {
    const roleChunk = pageRoles.slice(start, start + OPTIONS_PER_MENU);
    const chunkIndex = Math.floor(start / OPTIONS_PER_MENU);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`settings_roles:${currentPage}:${chunkIndex}`)
      .setPlaceholder(`Role ${currentPage * ITEMS_PER_PAGE + start + 1}–${currentPage * ITEMS_PER_PAGE + start + roleChunk.length}`)
      .setMinValues(0)
      .setMaxValues(roleChunk.length)
      .addOptions(roleChunk.map((role) => new StringSelectMenuOptionBuilder()
        .setLabel(role.name.slice(0, 100))
        .setValue(role.id)
        .setDefault(settings.allowedRoles.includes(role.id))));
    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  rows.push(buildPageControls('roles', currentPage, pageCount));
  return rows;
}

function buildLogChannelRows(guild, settings, botMember, page = 0) {
  const channels = getSettingsGuildTextChannels(guild);
  const pageCount = Math.max(1, Math.ceil(channels.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(Math.max(page, 0), pageCount - 1);
  const pageChannels = channels.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);
  const rows = [];

  for (let start = 0; start < pageChannels.length; start += OPTIONS_PER_MENU) {
    const channelChunk = pageChannels.slice(start, start + OPTIONS_PER_MENU);
    const chunkIndex = Math.floor(start / OPTIONS_PER_MENU);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`settings_log_channels:${currentPage}:${chunkIndex}`)
      .setPlaceholder(`Kênh ${currentPage * ITEMS_PER_PAGE + start + 1}–${currentPage * ITEMS_PER_PAGE + start + channelChunk.length}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(channelChunk.map((channel) => {
        const permissions = channel.permissionsFor(botMember);
        const canLog = permissions?.has(PermissionFlagsBits.ViewChannel)
          && permissions.has(PermissionFlagsBits.SendMessages)
          && permissions.has(PermissionFlagsBits.EmbedLinks);
        return new StringSelectMenuOptionBuilder()
          .setLabel(`#${channel.name}`.slice(0, 100))
          .setValue(channel.id)
          .setDescription(canLog ? 'Có thể gửi log' : 'Bot thiếu quyền gửi log')
          .setDefault(settings.logChannelId === channel.id);
      }));
    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  rows.push(buildPageControls('log', currentPage, pageCount));
  return rows;
}

export function buildSettingsComponents(guild, settings, screen = 'main', page = 0, botMember = guild.members.me) {
  if (screen === 'roles') {
    return buildRoleSelectionRows(guild, settings, page);
  }
  if (screen === 'log') {
    return buildLogChannelRows(guild, settings, botMember, page);
  }

  return [];
}

export async function handleSettingAutocomplete(interaction) {
  if (!canManageSettings(interaction) || !interaction.guild) {
    await interaction.respond([]);
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const focused = interaction.options.getFocused(true);
  const query = focused.value.trim().replace(/^[#@]/, '').toLocaleLowerCase();
  const settings = loadGuildSettings(interaction.guild.id);

  if (focused.name === 'role' && ['them-role', 'go-role'].includes(subcommand)) {
    await interaction.guild.roles.fetch();
    const isRemoving = subcommand === 'go-role';
    const allowedRoles = new Set(settings.allowedRoles);
    const results = getSettingsGuildRoles(interaction.guild)
      .filter((role) => (
        (isRemoving ? allowedRoles.has(role.id) : !allowedRoles.has(role.id))
        && `${role.name} ${role.id}`.toLocaleLowerCase().includes(query)
      ))
      .slice(0, 25)
      .map((role) => ({
        name: `@${role.name}`.slice(0, 100),
        value: role.id,
      }));
    await interaction.respond(results);
    return;
  }

  if (focused.name === 'kenh' && subcommand === 'kenh-log') {
    await interaction.guild.channels.fetch();
    const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
    const results = getSettingsGuildTextChannels(interaction.guild)
      .filter((channel) => `${channel.name} ${channel.id}`.toLocaleLowerCase().includes(query))
      .slice(0, 25)
      .map((channel) => {
        const permissions = channel.permissionsFor(botMember);
        const canLog = permissions?.has(PermissionFlagsBits.ViewChannel)
          && permissions.has(PermissionFlagsBits.SendMessages)
          && permissions.has(PermissionFlagsBits.EmbedLinks);
        return {
          name: `${canLog ? '' : '⚠ '}#${channel.name}`.slice(0, 100),
          value: channel.id,
        };
      });
    await interaction.respond(results);
    return;
  }

  await interaction.respond([]);
}

export async function handleSettingCommand(interaction) {
  if (!canManageSettings(interaction)) {
    await interaction.reply({
      content: 'Chỉ Administrator mới được quản lý /setting.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'them-role' || subcommand === 'go-role') {
    await interaction.guild.roles.fetch();
    const roleId = interaction.options.getString('role', true);
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role || role.id === interaction.guild.id) {
      await interaction.reply({
        content: 'Role đã chọn không hợp lệ hoặc không thuộc server này. Hãy chạy lại lệnh và tìm role khác.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const settings = loadGuildSettings(interaction.guild.id);
    const currentlyAllowed = settings.allowedRoles.includes(role.id);
    if (subcommand === 'them-role' && !currentlyAllowed) {
      settings.allowedRoles.push(role.id);
    } else if (subcommand === 'go-role' && currentlyAllowed) {
      settings.allowedRoles = settings.allowedRoles.filter((id) => id !== role.id);
    }
    saveGuildSettings(interaction.guild.id, settings);

    await interaction.reply({
      content: subcommand === 'them-role'
        ? currentlyAllowed
          ? `@${role.name} đã có quyền dùng bot.`
          : `✅ Đã cấp quyền dùng bot cho @${role.name}.`
        : currentlyAllowed
          ? `✅ Đã gỡ quyền dùng bot khỏi @${role.name}.`
          : `@${role.name} hiện không có quyền dùng bot.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'kenh-log') {
    await interaction.guild.channels.fetch();
    const channelId = interaction.options.getString('kenh', true);
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel || !LOG_CHANNEL_TYPES.has(channel.type) || channel.guildId !== interaction.guild.id) {
      await interaction.reply({
        content: 'Kênh đã chọn không hợp lệ hoặc không thuộc server này. Hãy chạy lại lệnh và tìm kênh khác.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel)
      || !permissions.has(PermissionFlagsBits.SendMessages)
      || !permissions.has(PermissionFlagsBits.EmbedLinks)
    ) {
      await interaction.reply({
        content: 'Bot cần quyền View Channel, Send Messages và Embed Links tại kênh log.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const settings = loadGuildSettings(interaction.guild.id);
    saveGuildSettings(interaction.guild.id, { ...settings, logChannelId: channel.id });
    await interaction.reply({
      content: `✅ Kênh log đã đặt thành <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'xoa-log') {
    const settings = loadGuildSettings(interaction.guild.id);
    saveGuildSettings(interaction.guild.id, { ...settings, logChannelId: null });
    await interaction.reply({
      content: '✅ Đã tắt log thông báo trong server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await Promise.all([
    interaction.guild.roles.fetch(),
    interaction.guild.channels.fetch(),
  ]);
  const settings = loadGuildSettings(interaction.guild.id);
  const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
  await interaction.reply({
    embeds: [buildSettingsEmbed(interaction.guild, settings)],
    components: buildSettingsComponents(interaction.guild, settings, 'main', 0, botMember),
    flags: MessageFlags.Ephemeral,
  });
}
