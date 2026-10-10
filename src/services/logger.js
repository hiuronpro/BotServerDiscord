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
  ) {
    throw new Error('Bot cần quyền View Channel và Send Messages tại kênh log.');
  }

  const embed = new EmbedBuilder()
    .setColor(APP_ACCENT)
    .setTitle('📢 Đã gửi thông báo')
    .addFields(
      {
        name: 'Người gửi',
        value: `${actor.globalName || actor.username} (\`@${actor.username} · ${actor.id}\`)`,
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

  if (permissions.has(PermissionFlagsBits.EmbedLinks)) {
    await logChannel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } else {
    await logChannel.send({
      content: [
        '📢 Đã gửi thông báo',
        `Người gửi: ${actor.globalName || actor.username} (@${actor.username} · ${actor.id})`,
        `Kênh nhận thông báo: #${announcementChannel.name} (${announcementChannel.id})`,
        `Tin nhắn: ${messageUrl || messageId}`,
        roleNames.length ? `Role được nhắc: ${roleNames.join(', ')}` : null,
      ].filter(Boolean).join('\n'),
      allowedMentions: { parse: [] },
    });
  }
  return true;
}
