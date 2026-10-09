import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';

const TEXT_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const SESSION_TTL_MS = 15 * 60 * 1000;
const announcementSessions = new Map();

export function createAnnouncementSession({
  guildId,
  userId,
  channelId = null,
  roleIds = [],
  specialMention = null,
}) {
  const now = Date.now();
  for (const [id, session] of announcementSessions) {
    if (now - session.createdAt >= SESSION_TTL_MS) {
      announcementSessions.delete(id);
    }
  }

  const id = randomBytes(8).toString('hex');
  const session = {
    id,
    guildId,
    userId,
    hasComposerMessage: false,
    createdAt: now,
    title: '',
    content: '',
    imageUrl: '',
    footer: '',
    files: [],
    channelId,
    roleIds: [...new Set(roleIds)],
    specialMention: ['everyone', 'here'].includes(specialMention) ? specialMention : null,
    sent: false,
    sending: false,
    mainMessageSent: false,
    mentionsSent: false,
  };
  announcementSessions.set(id, session);
  return session;
}

export function getAnnouncementSession(id) {
  const session = announcementSessions.get(id);
  if (!session) {
    return null;
  }

  if (Date.now() - session.createdAt >= SESSION_TTL_MS) {
    announcementSessions.delete(id);
    return null;
  }

  return session;
}

export function deleteAnnouncementSession(id) {
  announcementSessions.delete(id);
}

export async function getAvailableAnnouncementChannels(guild, botMember) {
  await guild.channels.fetch();
  const available = [];

  for (const channel of guild.channels.cache.values()) {
    if (!TEXT_CHANNEL_TYPES.has(channel.type)) {
      continue;
    }

    const permissions = channel.permissionsFor(botMember);
    const canSend = permissions?.has(PermissionFlagsBits.SendMessages) ?? false;
    const missingPermissions = [
      !canSend && 'Send Messages',
    ].filter(Boolean);
    available.push({
      label: `#${channel.name}`.slice(0, 100),
      value: channel.id,
      description: missingPermissions.length
        ? `Bot thiếu: ${missingPermissions.join(', ')}`.slice(0, 100)
        : channel.topic?.slice(0, 100) || 'Bot có thể gửi thông báo',
      canSend,
    });
  }

  return available.sort((left, right) => left.label.localeCompare(right.label));
}

export function buildAnnouncementComposerRows(sessionId, { hasContent = false, warning = false } = {}) {
  const editButton = new ButtonBuilder()
    .setCustomId(`tb:${sessionId}:${hasContent && !warning ? 'preview' : 'edit'}`)
    .setLabel(hasContent && !warning ? '👁️ Xem trước' : hasContent ? '✏️ Sửa bản nháp' : '✏️ Soạn nội dung')
    .setStyle(hasContent && !warning ? ButtonStyle.Success : ButtonStyle.Primary);
  const cancelButton = new ButtonBuilder()
    .setCustomId(`tb:${sessionId}:cancel`)
    .setLabel('❌ Hủy')
    .setStyle(ButtonStyle.Danger);
  return [new ActionRowBuilder().addComponents(editButton, cancelButton)];
}

export function buildAnnouncementPreviewRows(sessionId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tb:${sessionId}:edit`)
        .setLabel('✏️ Chỉnh sửa')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`tb:${sessionId}:confirm`)
        .setLabel('📨 Gửi thông báo')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`tb:${sessionId}:cancel`)
        .setLabel('❌ Hủy')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function getAnnouncementBodyContent(state) {
  const roleIds = getRoleMentionIds(state);
  const content = String(state.content ?? '')
    .replace(/<@&(\d{17,20})>/g, '')
    .trimEnd();
  const mentions = roleIds.map((roleId) => `<@&${roleId}>`).join(' ');
  return [content, mentions].filter(Boolean).join('\n\n');
}

export function getRoleMentionIds(state) {
  const mentions = new Set(
    [...String(state.content ?? '').matchAll(/<@&(\d{17,20})>/g)].map((match) => match[1]),
  );
  for (const roleId of state.roleIds || []) {
    if (roleId && roleId !== 'none') {
      mentions.add(roleId);
    }
  }
  if (state.roleId && state.roleId !== 'none') {
    mentions.add(state.roleId);
  }
  return [...mentions];
}

export function announcementNeedsEmbed(state) {
  const body = getAnnouncementBodyContent(state);
  return Boolean(state.title || state.imageUrl || state.footer || body.length > 2000);
}
