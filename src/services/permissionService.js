import { PermissionFlagsBits } from 'discord.js';
import { loadGuildSettings } from './settingsService.js';

export function isAdministrator(member) {
  if (!member || !member.permissions) {
    return false;
  }

  return member.permissions.has(PermissionFlagsBits.Administrator);
}

export function canManageSettings(interaction) {
  if (!interaction || !interaction.member || !interaction.guild) {
    return false;
  }

  return isAdministrator(interaction.member);
}

export function canUseAnnouncement(interaction) {
  if (!interaction || !interaction.member || !interaction.guild) {
    return false;
  }

  if (isAdministrator(interaction.member)) {
    return true;
  }

  const settings = loadGuildSettings(interaction.guild.id);
  const memberRoleIds = new Set((interaction.member.roles?.cache?.map((role) => role.id)) || []);

  if (Array.isArray(settings.allowedRoles) && settings.allowedRoles.some((roleId) => memberRoleIds.has(roleId))) {
    return true;
  }

  return false;
}

export async function isRoleMentionAllowed(guild, roleId, botMember, channel = null) {
  if (!guild || !roleId) {
    return false;
  }

  const role = guild.roles.cache.get(String(roleId));
  if (!role || role.id === guild.id || role.name === '@here') {
    return false;
  }

  if (!botMember) {
    return false;
  }

  const mentionPermission = channel
    ? Boolean(channel.permissionsFor(botMember)?.has(PermissionFlagsBits.MentionEveryone))
    : botMember.permissions.has(PermissionFlagsBits.MentionEveryone);
  const canMention = role.mentionable || mentionPermission;
  return canMention;
}

export function canMentionEveryone(channel, botMember) {
  return Boolean(
    channel
    && botMember
    && channel.permissionsFor(botMember)?.has(PermissionFlagsBits.MentionEveryone),
  );
}

export async function isChannelUsableForAnnouncement(guild, channelId, botMember, requiresEmbed = false) {
  if (!guild || !channelId || !botMember) {
    return false;
  }

  const channel = guild.channels.cache.get(String(channelId));
  if (!channel || ![0, 5].includes(channel.type) || channel.guildId !== guild.id) {
    return false;
  }

  const permissions = channel.permissionsFor(botMember);
  if (!permissions) {
    return false;
  }

  return permissions.has(PermissionFlagsBits.SendMessages)
    && (!requiresEmbed || permissions.has(PermissionFlagsBits.EmbedLinks));
}
