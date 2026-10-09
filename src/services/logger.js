import fs from 'node:fs';
import path from 'node:path';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { APP_ACCENT } from '../utils/constants.js';

const logDirectory = path.resolve(process.cwd(), 'logs');
const logFile = path.join(logDirectory, 'announcement.log');

export function ensureLogFile() {
  fs.mkdirSync(logDirectory, { recursive: true });

  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, '', 'utf8');
  }
}

export function logAnnouncementEvent({ guildId, channelId, roleId, roleName, actorId, actorDisplayName, successful, message }) {
  ensureLogFile();

  const entry = {
    timestamp: new Date().toISOString(),
    guildId,
    channelId,
    roleId: roleId || null,
    roleName: roleName || null,
    actorId,
    actorDisplayName,
    successful: Boolean(successful),
    message,
  };

  fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function sendAnnouncementLog({
  guild,
  botMember,
  logChannelId,
  announcementChannel,
  actor,
  messageId,
  messageUrl,
  roleNames,
}) {
  if (!logChannelId) {
    return false;
  }

  const logChannel = guild.channels.cache.get(logChannelId)
    ?? await guild.channels.fetch(logChannelId);
  if (
    !logChannel
    || logChannel.guildId !== guild.id
    || ![0, 5].includes(logChannel.type)
  ) {
    throw new Error('Kênh log đã bị xóa hoặc không còn là kênh văn bản trong server.');
  }

  const permissions = logChannel.permissionsFor(botMember);
  if (
    !permissions?.has(PermissionFlagsBits.ViewChannel)
    || !permissions.has(PermissionFlagsBits.SendMessages)
    || !permissions.has(PermissionFlagsBits.EmbedLinks)
  ) {
    throw new Error('Bot cần quyền View Channel, Send Messages và Embed Links tại kênh log.');
  }

  const embed = new EmbedBuilder()
    .setColor(APP_ACCENT)
    .setTitle('📢 Đã gửi thông báo')
    .addFields(
      {
        name: 'Người gửi',
        value: `<@${actor.id}> (\`${actor.tag || actor.username}\` · \`${actor.id}\`)`,
        inline: false,
      },
      {
        name: 'Kênh nhận thông báo',
        value: `<#${announcementChannel.id}> (\`${announcementChannel.name}\`)`,
        inline: true,
      },
      {
        name: 'Tin nhắn',
        value: messageUrl ? `[Mở thông báo](${messageUrl}) · \`${messageId}\`` : `\`${messageId}\``,
        inline: true,
      },
      ...(roleNames.length
        ? [{ name: 'Role được nhắc', value: roleNames.join(', ').slice(0, 1024), inline: false }]
        : []),
    )
    .setTimestamp(new Date());

  await logChannel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
  return true;
}
