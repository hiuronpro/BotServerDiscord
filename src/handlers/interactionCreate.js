import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import {
  handleThongbaoAutocomplete,
  handleThongbaoCommand,
  buildAnnouncementModal,
} from '../commands/thongbao.js';
import {
  buildSettingsComponents,
  buildSettingsEmbed,
  getSettingsGuildRoles,
  getSettingsGuildTextChannels,
  handleSettingAutocomplete,
  handleSettingCommand,
} from '../commands/setting.js';
import {
  announcementNeedsEmbed,
  buildAnnouncementComposerRows,
  buildAnnouncementPreviewRows,
  createAnnouncementSession,
  deleteAnnouncementSession,
  getAnnouncementBodyContent,
  getRoleMentionIds,
  getAnnouncementSession,
  getAvailableAnnouncementChannels,
} from '../services/announcementService.js';
import { logAnnouncementEvent, sendAnnouncementLog } from '../services/logger.js';
import {
  canManageSettings,
  canUseAnnouncement,
  canMentionEveryone,
  isChannelUsableForAnnouncement,
  isRoleMentionAllowed,
} from '../services/permissionService.js';
import { loadGuildSettings, saveGuildSettings } from '../services/settingsService.js';
import { buildAnnouncementMessageEmbed, buildAnnouncementPreview } from '../utils/embeds.js';
import { APP_ACCENT } from '../utils/constants.js';
import { validateAnnouncementInput } from '../utils/validators.js';

const SESSION_CUSTOM_ID = /^tb:([0-9a-f]{16}):([a-z0-9-]+)$/;
const MODAL_CUSTOM_ID = /^tb:([0-9a-f]{16}):modal$/;

function getSessionFromCustomId(interaction, pattern = SESSION_CUSTOM_ID) {
  const match = interaction.customId.match(pattern);
  if (!match) {
    return null;
  }

  const session = getAnnouncementSession(match[1]);
  if (
    !session
    || session.guildId !== interaction.guildId
    || session.userId !== interaction.user.id
  ) {
    return null;
  }

  return { session, action: match[2] };
}

function buildComposerEmbed(session, guild, channelOptions, warning = '') {
  const channel = channelOptions.find((option) => option.value === session.channelId);
  const roleNames = getRoleMentionIds(session)
    .map((roleId) => guild.roles.cache.get(roleId)?.name)
    .filter(Boolean);
  return new EmbedBuilder()
    .setColor(APP_ACCENT)
    .setTitle('📢 SOẠN THÔNG BÁO')
    .setDescription([
      session.content
        ? 'Bản nháp đã lưu. Bấm Xem trước để duyệt hoặc mở lại biểu mẫu để sửa nội dung, emoji và ảnh. Muốn đổi kênh hoặc role, hãy chạy lại /thongbao.'
        : 'Kênh và các role đã chọn trong /thongbao. Mở biểu mẫu để nhập nội dung, chọn emoji và tải ảnh.',
      'Thông báo chỉ được gửi sau khi xác nhận ở màn hình xem trước.',
      warning,
      channelOptions.length
        ? `Server: **${guild.name}** · Có thể gửi vào kênh riêng nếu bot được cấp quyền gửi tin.`
        : '⚠️ Không tìm thấy kênh văn bản trong server. Kiểm tra quyền View Channel của bot.',
    ].filter(Boolean).join('\n\n'))
    .addFields(
      {
        name: '📍 Kênh gửi',
        value: channel
          ? `${channel.label}${channel.canSend ? '' : `\n⚠️ ${channel.description}`}`
          : 'Chưa chọn kênh.',
        inline: false,
      },
      {
        name: '🏷️ Role được nhắc',
        value: [
          ...roleNames.map((name) => `@${name}`),
          ...(session.specialMention ? [`@${session.specialMention}`] : []),
        ].join(', ').slice(0, 1024) || 'Không nhắc role nào',
        inline: false,
      },
      {
        name: '✍️ Bản nháp',
        value: session.content
          ? `${session.content.slice(0, 500)}${session.content.length > 500 ? '…' : ''}\n\n${session.content.length} ký tự • ${(session.files || []).length} ảnh`
          : 'Chưa soạn nội dung.',
        inline: false,
      },
    );
}

async function respondToModalError(interaction, session, message) {
  const components = buildAnnouncementComposerRows(session.id, {
    hasContent: Boolean(session.content.trim()),
    warning: true,
  });
  const content = `${message}\n\nBản nháp đã được giữ lại. Chọn **Sửa bản nháp** để thử lại.`;
  if (session.hasComposerMessage) {
    await interaction.update({ content, embeds: [], components });
    return;
  }

  await interaction.reply({
    content,
    components,
    flags: MessageFlags.Ephemeral,
  });
  session.hasComposerMessage = true;
}

async function refreshComposer(interaction, session, warning = '') {
  await interaction.guild.roles.fetch();
  session.roleIds = session.roleIds.filter((roleId) => interaction.guild.roles.cache.has(roleId));
  const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
  const channelOptions = await getAvailableAnnouncementChannels(interaction.guild, botMember);

  if (!channelOptions.some((option) => option.value === session.channelId)) {
    session.channelId = null;
  }

  await interaction.update({
    content: '',
    embeds: [buildComposerEmbed(session, interaction.guild, channelOptions, warning)],
    components: buildAnnouncementComposerRows(session.id, {
      hasContent: Boolean(session.content.trim()),
      warning: Boolean(warning),
    }),
  });
}

async function showPreview(interaction, session) {
  if (!session.content.trim()) {
    await interaction.reply({
      content: 'Nhập nội dung thông báo trước khi xem trước hoặc gửi.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!session.channelId) {
    await interaction.reply({
      content: 'Hãy chọn kênh gửi trước khi xem trước hoặc gửi.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
  const channels = await getAvailableAnnouncementChannels(interaction.guild, botMember);
  const channelOption = channels.find((option) => option.value === session.channelId);
  if (!channelOption) {
    await refreshComposer(interaction, session, '⚠️ Kênh đã chọn không còn khả dụng. Hãy chọn kênh khác.');
    return;
  }

  const selectedChannel = interaction.guild.channels.cache.get(session.channelId);
  const mentionRoleIds = getRoleMentionIds(session);
  if (mentionRoleIds.some((roleId) => !interaction.guild.roles.cache.has(roleId))) {
    await refreshComposer(
      interaction,
      session,
      '⚠️ Có role mention không tồn tại trong server. Hãy sửa nội dung.',
    );
    return;
  }
  for (const roleId of mentionRoleIds) {
    if (!(await isRoleMentionAllowed(
      interaction.guild,
      roleId,
      botMember,
      selectedChannel,
    ))) {
      await refreshComposer(interaction, session, '⚠️ Bot không có quyền mention một role trong kênh đã chọn.');
      return;
    }
  }
  const fullRoleLabel = [
    ...mentionRoleIds.map((roleId) => `@${interaction.guild.roles.cache.get(roleId)?.name || 'role'}`),
    ...(session.specialMention ? [`@${session.specialMention}`] : []),
  ].join(', ') || 'Không nhắc role nào';
  const roleLabel = fullRoleLabel.length > 1024
    ? `${fullRoleLabel.slice(0, 1021)}…`
    : fullRoleLabel;

  const requiresEmbed = announcementNeedsEmbed(session);
  const usable = await isChannelUsableForAnnouncement(
    interaction.guild,
    session.channelId,
    botMember,
    requiresEmbed,
  );
  if (!usable) {
    await refreshComposer(
      interaction,
      session,
      requiresEmbed
        ? '⚠️ Bot cần quyền Send Messages và Embed Links tại kênh đã chọn. Hãy chọn kênh khác hoặc cấp quyền cho bot.'
        : '⚠️ Bot cần quyền Send Messages tại kênh đã chọn. Hãy chọn kênh khác hoặc cấp quyền cho bot.',
    );
    return;
  }
  const containsEveryoneMention = /@(everyone|here)\b/i.test(session.content);
  if (containsEveryoneMention && !canMentionEveryone(selectedChannel, botMember)) {
    await refreshComposer(
      interaction,
      session,
      '⚠️ Để ping @everyone hoặc @here, bot cần quyền Mention Everyone trong kênh này.',
    );
    return;
  }

  const body = getAnnouncementBodyContent(session);
  const includeContentInEmbed = body.length > 2000;
  const messageContent = includeContentInEmbed ? undefined : body;
  const embed = buildAnnouncementPreview({
    title: session.title,
    content: includeContentInEmbed
      ? String(session.content ?? '').replace(/<@&(\d{17,20})>/g, '').trimEnd()
      : session.content,
    imageUrl: session.imageUrl || session.files?.[0]?.url,
    footer: session.footer,
    channelLabel: channelOption.label,
    roleLabel,
    includeContent: includeContentInEmbed,
  });

  const preview = {
    content: messageContent,
    embeds: [embed],
    components: buildAnnouncementPreviewRows(session.id),
    allowedMentions: { parse: [] },
  };
  if (session.hasComposerMessage) {
    await interaction.update(preview);
  } else {
    await interaction.reply({ ...preview, flags: MessageFlags.Ephemeral });
    session.hasComposerMessage = true;
  }
}

async function confirmAnnouncement(interaction, session) {
  if (session.sent || session.sending) {
    await interaction.reply({
      content: 'Thông báo này đang được gửi hoặc đã được gửi.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!canUseAnnouncement(interaction)) {
    deleteAnnouncementSession(session.id);
    await interaction.reply({
      content: 'Bạn không còn quyền gửi thông báo trong server này.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const validation = validateAnnouncementInput(session);
  if (!validation.valid) {
    await interaction.reply({
      content: validation.errors.join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  session.sending = true;
  try {
    await confirmAnnouncementLocked(interaction, session);
  } finally {
    if (!session.sent) {
      session.sending = false;
    }
  }
}

async function confirmAnnouncementLocked(interaction, session) {
  const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
  const channelOption = (await getAvailableAnnouncementChannels(interaction.guild, botMember))
    .find((option) => option.value === session.channelId);
  const channel = interaction.guild.channels.cache.get(String(session.channelId));
  if (!channelOption || !channel || channel.guildId !== session.guildId) {
    await refreshComposer(interaction, session, '⚠️ Kênh đã chọn không còn khả dụng. Hãy chọn kênh khác.');
    return;
  }

  const mentionRoleIds = getRoleMentionIds(session);
  const invalidMention = mentionRoleIds.some((roleId) => (
    !interaction.guild.roles.cache.has(roleId)
  ));
  if (invalidMention) {
    await refreshComposer(
      interaction,
      session,
      '⚠️ Có role mention trong nội dung không còn được phép. Hãy sửa nội dung hoặc chọn role hợp lệ.',
    );
    return;
  }
  const mentionRoles = mentionRoleIds
    .map((roleId) => interaction.guild.roles.cache.get(roleId))
    .filter(Boolean);
  const roleId = mentionRoleIds.join(',') || null;
  const roleName = mentionRoles.map((role) => role.name).join(', ') || null;

  const requiresEmbed = announcementNeedsEmbed(session);
  const permissions = channel.permissionsFor(botMember);
  const canSend = permissions?.has(PermissionFlagsBits.SendMessages)
    && (!requiresEmbed || permissions.has(PermissionFlagsBits.EmbedLinks));
  if (!canSend) {
    await refreshComposer(
      interaction,
      session,
      requiresEmbed
        ? '⚠️ Bot cần quyền Send Messages và Embed Links tại kênh đã chọn. Hãy chọn kênh khác hoặc cấp quyền cho bot.'
        : '⚠️ Bot cần quyền Send Messages tại kênh đã chọn. Hãy chọn kênh khác hoặc cấp quyền cho bot.',
    );
    return;
  }
  for (const roleId of mentionRoleIds) {
    if (!(await isRoleMentionAllowed(interaction.guild, roleId, botMember, channel))) {
      await refreshComposer(interaction, session, '⚠️ Bot không có quyền mention một role trong kênh đã chọn.');
      return;
    }
  }

  const containsEveryoneMention = /@(everyone|here)\b/i.test(session.content);
  const canParseEveryone = containsEveryoneMention && canMentionEveryone(channel, botMember);
  if (containsEveryoneMention && !canParseEveryone) {
    await refreshComposer(
      interaction,
      session,
      '⚠️ Để ping @everyone hoặc @here, bot cần quyền Mention Everyone trong kênh này.',
    );
    return;
  }

  const body = getAnnouncementBodyContent(session);
  const includeContentInEmbed = body.length > 2000;
  const announcementText = String(session.content ?? '')
    .replace(/<@&(\d{17,20})>/g, '')
    .trimEnd();
  const embed = buildAnnouncementMessageEmbed({
    title: session.title,
    content: includeContentInEmbed ? announcementText : body,
    imageUrl: session.imageUrl,
    footer: session.footer,
    includeContent: includeContentInEmbed,
  });
  const payload = {
    content: includeContentInEmbed ? undefined : body,
    embeds: embed ? [embed] : [],
    files: (session.files || []).map((file) => ({
      attachment: file.url,
      name: file.name,
    })),
    allowedMentions: {
      parse: canParseEveryone ? ['everyone'] : [],
      roles: mentionRoleIds,
    },
  };

  try {
    await interaction.deferUpdate();
  } catch (error) {
    session.sending = false;
    throw error;
  }
  try {
    if (!session.mainMessageSent) {
      const sentMessage = await channel.send(payload);
      session.mainMessageSent = true;
      session.sentMessageId = sentMessage.id;
      session.sentMessageUrl = sentMessage.url;
    }
    if (includeContentInEmbed && !session.mentionsSent) {
      const trailingMentions = [
        ...mentionRoleIds.map((id) => `<@&${id}>`),
        ...new Set(session.content.match(/@(everyone|here)\b/gi) || []),
      ];
      if (trailingMentions.length) {
        await channel.send({
          content: trailingMentions.join(' '),
          allowedMentions: {
            parse: canParseEveryone ? ['everyone'] : [],
            roles: mentionRoleIds,
          },
        });
      }
      session.mentionsSent = true;
    }
  } catch (error) {
    session.sending = false;
    try {
      logAnnouncementEvent({
        guildId: session.guildId,
        channelId: channel.id,
        roleId,
        roleName,
        actorId: interaction.user.id,
        actorDisplayName: interaction.user.tag,
        successful: false,
        message: error.message,
      });
    } catch (loggingError) {
      console.error('Không thể ghi log gửi thông báo thất bại:', loggingError);
    }
    await interaction.followUp({
      content: 'Không gửi được thông báo. Kiểm tra quyền của bot tại kênh rồi thử lại.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  session.sent = true;
  deleteAnnouncementSession(session.id);
  try {
    logAnnouncementEvent({
      guildId: session.guildId,
      channelId: channel.id,
      roleId,
      roleName,
      actorId: interaction.user.id,
      actorDisplayName: interaction.user.tag,
      successful: true,
      message: `Announcement message ${session.sentMessageId} sent to #${channel.name}`,
    });
  } catch (error) {
    console.error('Không thể ghi log thông báo đã gửi:', error);
  }

  let logWarning = '';
  try {
    const settings = loadGuildSettings(session.guildId);
    const wasLogged = await sendAnnouncementLog({
      guild: interaction.guild,
      botMember,
      logChannelId: settings.logChannelId,
      announcementChannel: channel,
      actor: interaction.user,
      messageId: session.sentMessageId,
      messageUrl: session.sentMessageUrl,
      roleNames: mentionRoles.map((role) => role.name),
    });
    if (!wasLogged && settings.logChannelId) {
      logWarning = ' Không gửi được log vào kênh đã cấu hình.';
    }
  } catch (error) {
    console.error('Không thể ghi log thông báo vào Discord:', error);
    logWarning = ` Thông báo đã gửi, nhưng ghi log Discord thất bại: ${error.message}`;
  }

  await interaction.editReply({
    content: `✅ Thông báo đã được gửi thành công.${logWarning}`,
    embeds: [],
    components: [],
  });
}

export async function interactionCreate(interaction) {
  if (interaction.isAutocomplete() && interaction.commandName === 'thongbao') {
    await handleThongbaoAutocomplete(interaction);
    return;
  }

  if (interaction.isAutocomplete() && interaction.commandName === 'setting') {
    await handleSettingAutocomplete(interaction);
    return;
  }

  if (interaction.isChatInputCommand()) {
    console.info(
      `[${new Date().toISOString()}] [COMMAND] /${interaction.commandName} | user=${interaction.user.tag} (${interaction.user.id}) | server=${interaction.guild?.name ?? 'DM'} (${interaction.guildId ?? 'n/a'}) | channel=${interaction.channel?.name ?? 'unknown'} (${interaction.channelId ?? 'n/a'})`,
    );

    if (interaction.commandName === 'thongbao') {
      await handleThongbaoCommand(interaction);
      return;
    }
    if (interaction.commandName === 'setting') {
      await handleSettingCommand(interaction);
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    const match = interaction.customId.match(MODAL_CUSTOM_ID);
    if (!match) return;

    const session = getAnnouncementSession(match[1]);
    if (
      !session
      || session.guildId !== interaction.guildId
      || session.userId !== interaction.user.id
    ) {
      await interaction.reply({
        content: 'Phiên soạn đã hết hạn hoặc không thuộc về bạn. Hãy chạy lại /thongbao.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!canUseAnnouncement(interaction)) {
      deleteAnnouncementSession(session.id);
      await interaction.reply({
        content: 'Bạn không còn quyền gửi thông báo trong server này.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await Promise.all([
      interaction.guild.roles.fetch(),
      interaction.guild.channels.fetch(),
    ]);
    const selectedChannel = interaction.guild.channels.cache.get(session.channelId);
    const selectedRoleIds = [...new Set(session.roleIds)];
    const previousSpecialMention = session.specialMention;
    const typedContent = interaction.fields.getTextInputValue('content');
    const contentWithoutPreviousMention = previousSpecialMention
      ? typedContent.replace(new RegExp(`\\s*@${previousSpecialMention}\\s*$`, 'i'), '').trimEnd()
      : typedContent;
    const content = contentWithoutPreviousMention;
    const selectedMention = session.specialMention ? `@${session.specialMention}` : '';
    const contentWithSpecialMention = selectedMention
      && !new RegExp(`${selectedMention}\\b`, 'i').test(content)
      ? `${content}${content && !/\s$/.test(content) ? '\n\n' : ''}${selectedMention}`
      : content;
    session.content = contentWithSpecialMention;
    session.channelId = selectedChannel?.id || session.channelId;
    session.roleIds = [...new Set(selectedRoleIds)];
    const input = {
      title: '',
      content: contentWithSpecialMention,
      imageUrl: '',
      footer: '',
    };
    const validation = validateAnnouncementInput(input);
    if (!validation.valid) {
      await respondToModalError(interaction, session, validation.errors.join('\n'));
      return;
    }

    if (
      !selectedChannel
      || selectedChannel.guildId !== interaction.guild.id
      || ![0, 5].includes(selectedChannel.type)
    ) {
      await respondToModalError(interaction, session, 'Hãy chọn một kênh văn bản hợp lệ trong server này.');
      return;
    }
    if (
      selectedRoleIds.length > 25
      || selectedRoleIds.some((roleId) => (
        roleId === interaction.guild.id || !interaction.guild.roles.cache.has(roleId)
      ))
    ) {
      await respondToModalError(
        interaction,
        session,
        'Có role không hợp lệ. Hãy chạy lại /thongbao và chọn tối đa 25 role.',
      );
      return;
    }

    const uploadedFiles = interaction.fields.getUploadedFiles('images');
    const files = uploadedFiles ? [...uploadedFiles.values()] : [];
    const invalidFile = files.find((file) => !file.contentType?.toLowerCase().startsWith('image/'));
    if (invalidFile) {
      await respondToModalError(
        interaction,
        session,
        `Tệp "${invalidFile.name}" không phải ảnh. Chỉ có thể tải lên ảnh.`,
      );
      return;
    }
    const normalizedFiles = files.map((file) => ({
      id: file.id,
      url: file.url,
      name: file.name,
      contentType: file.contentType,
      size: file.size,
    }));

    Object.assign(session, input, {
      channelId: selectedChannel.id,
      roleIds: [...new Set(selectedRoleIds)],
      files: normalizedFiles.length ? normalizedFiles : (session.files || []),
    });
    await showPreview(interaction, session);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('settings_roles:')) {
    if (!canManageSettings(interaction)) {
      await interaction.reply({
        content: 'Chỉ Administrator mới được thay đổi cài đặt.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.guild.roles.fetch();
    const [, pageText, chunkText] = interaction.customId.split(':');
    const page = Number(pageText);
    const chunkIndex = Number(chunkText);
    if (!Number.isInteger(page) || page < 0 || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
      await interaction.reply({
        content: 'Danh sách role không hợp lệ. Hãy mở lại /setting.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const allRoles = getSettingsGuildRoles(interaction.guild);
    const pageRoles = allRoles.slice(page * 100, (page + 1) * 100);
    const roleChunk = pageRoles.slice(chunkIndex * 25, (chunkIndex + 1) * 25);
    const chunkRoleIds = new Set(roleChunk.map((role) => role.id));
    const selectedRoleIds = interaction.values.filter((roleId) => chunkRoleIds.has(roleId));
    if (selectedRoleIds.length !== interaction.values.length) {
      await interaction.reply({
        content: 'Có role không hợp lệ trong lựa chọn. Hãy mở lại /setting.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildSettings = loadGuildSettings(interaction.guild.id);
    guildSettings.allowedRoles = [
      ...guildSettings.allowedRoles.filter((roleId) => !chunkRoleIds.has(roleId)),
      ...selectedRoleIds,
    ];
    const savedSettings = saveGuildSettings(interaction.guild.id, guildSettings);
    const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
    await interaction.update({
      content: `✅ Đã lưu quyền cho ${roleChunk.length} role trong nhóm này.`,
      embeds: [buildSettingsEmbed(interaction.guild, savedSettings, 'roles')],
      components: buildSettingsComponents(interaction.guild, savedSettings, 'roles', page, botMember),
    });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('settings_log_channels:')) {
    if (!canManageSettings(interaction)) {
      await interaction.reply({
        content: 'Chỉ Administrator mới được thay đổi cài đặt.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.guild.channels.fetch();
    const [, pageText, chunkText] = interaction.customId.split(':');
    const page = Number(pageText);
    const chunkIndex = Number(chunkText);
    const channels = getSettingsGuildTextChannels(interaction.guild);
    const pageChannels = channels.slice(page * 100, (page + 1) * 100);
    const channelChunk = pageChannels.slice(chunkIndex * 25, (chunkIndex + 1) * 25);
    const channelId = interaction.values[0];
    const channel = channelChunk.find((candidate) => candidate.id === channelId);
    if (!channel || channel.guildId !== interaction.guild.id) {
      await interaction.reply({
        content: 'Kênh được chọn không hợp lệ. Hãy mở lại /setting.',
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
    const savedSettings = saveGuildSettings(interaction.guild.id, {
      ...settings,
      logChannelId: channel.id,
    });
    await interaction.update({
      content: `✅ Kênh log đã đặt thành <#${channel.id}>.`,
      embeds: [buildSettingsEmbed(interaction.guild, savedSettings, 'log')],
      components: buildSettingsComponents(interaction.guild, savedSettings, 'log', page, botMember),
    });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('settings_')) {
    if (!canManageSettings(interaction)) {
      await interaction.reply({
        content: 'Chỉ Administrator mới được thay đổi cài đặt.',
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
    if (
      interaction.customId === 'settings_roles'
      || interaction.customId === 'settings_edit_roles'
      || interaction.customId === 'settings_add_roles'
      || interaction.customId === 'settings_remove_roles'
    ) {
      await interaction.update({
        content: '',
        embeds: [buildSettingsEmbed(interaction.guild, settings, 'roles')],
        components: buildSettingsComponents(interaction.guild, settings, 'roles', 0, botMember),
      });
      return;
    }
    if (interaction.customId === 'settings_log') {
      await interaction.update({
        content: '',
        embeds: [buildSettingsEmbed(interaction.guild, settings, 'log')],
        components: buildSettingsComponents(interaction.guild, settings, 'log', 0, botMember),
      });
      return;
    }
    const pageMatch = interaction.customId.match(/^settings_(roles|log)_page:(\d+)$/);
    if (pageMatch) {
      const [, screen, pageText] = pageMatch;
      const page = Number(pageText);
      await interaction.update({
        content: '',
        embeds: [buildSettingsEmbed(interaction.guild, settings, screen)],
        components: buildSettingsComponents(interaction.guild, settings, screen, page, botMember),
      });
      return;
    }
    if (interaction.customId === 'settings_roles_back' || interaction.customId === 'settings_log_back') {
      await interaction.update({
        content: '',
        embeds: [buildSettingsEmbed(interaction.guild, settings)],
        components: buildSettingsComponents(interaction.guild, settings, 'main', 0, botMember),
      });
      return;
    }
    if (interaction.customId === 'settings_clear_log_channel') {
      const savedSettings = saveGuildSettings(interaction.guild.id, {
        ...settings,
        logChannelId: null,
      });
      await interaction.update({
        content: '✅ Đã tắt log thông báo trong server.',
        embeds: [buildSettingsEmbed(interaction.guild, savedSettings)],
        components: buildSettingsComponents(interaction.guild, savedSettings, 'main', 0, botMember),
      });
      return;
    }
    if (interaction.customId === 'settings_done') {
      await interaction.update({
        content: '✅ Cài đặt quyền đã lưu.',
        embeds: [buildSettingsEmbed(interaction.guild, settings)],
        components: buildSettingsComponents(interaction.guild, settings, 'main', 0, botMember),
      });
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('tb:')) {
    const sessionResult = getSessionFromCustomId(interaction);
    if (!sessionResult) {
      await interaction.reply({
        content: 'Phiên soạn đã hết hạn hoặc không thuộc về bạn.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { session, action } = sessionResult;
    if (action !== 'cancel' && !canUseAnnouncement(interaction)) {
      deleteAnnouncementSession(session.id);
      await interaction.reply({
        content: 'Bạn không còn quyền gửi thông báo trong server này.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'cancel') {
      deleteAnnouncementSession(session.id);
      await interaction.update({
        content: 'Đã hủy soạn thông báo.',
        embeds: [],
        components: [],
      });
      return;
    }

    if (action === 'edit') {
      const modalSession = {
        ...session,
        roleIds: session.roleIds.filter((roleId) => interaction.guild.roles.cache.has(roleId)),
      };
      await interaction.showModal(await buildAnnouncementModal(interaction.guild, modalSession));
      return;
    }

    if (action === 'preview') {
      await showPreview(interaction, session);
      return;
    }

    if (action === 'confirm') {
      await confirmAnnouncement(interaction, session);
    }
  }
}
