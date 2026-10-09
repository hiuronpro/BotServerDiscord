import { EmbedBuilder } from 'discord.js';
import { APP_ACCENT, BOT_NAME } from './constants.js';

function applyAnnouncementDetails(embed, { title, imageUrl, footer }) {
  const cleanTitle = String(title ?? '').trim();
  const cleanImageUrl = String(imageUrl ?? '').trim();
  const cleanFooter = String(footer ?? '').trim();

  if (cleanTitle) {
    embed.setTitle(cleanTitle);
  }

  if (cleanImageUrl) {
    embed.setImage(cleanImageUrl);
  }

  if (cleanFooter) {
    const brandedFooter = `${BOT_NAME} • ${cleanFooter}`;
    embed.setFooter({ text: brandedFooter.length <= 2048 ? brandedFooter : cleanFooter });
  }

  return embed;
}

export function buildAnnouncementPreview({
  title,
  content,
  imageUrl,
  footer,
  channelLabel,
  roleLabel,
  includeContent = false,
}) {
  const embed = applyAnnouncementDetails(
    new EmbedBuilder().setColor(APP_ACCENT),
    { title, imageUrl, footer },
  );

  if (includeContent) {
    embed.setDescription(String(content ?? ''));
  }

  if (channelLabel || roleLabel) {
    embed.addFields(
      { name: 'Kênh gửi', value: channelLabel || 'Chưa chọn', inline: true },
      { name: 'Role được nhắc', value: roleLabel || 'Không nhắc role nào', inline: true },
    );
  }

  return embed;
}

export function buildAnnouncementMessageEmbed({ title, content, imageUrl, footer, includeContent = false }) {
  const hasDetails = Boolean(
    String(title ?? '').trim()
    || String(imageUrl ?? '').trim()
    || String(footer ?? '').trim(),
  );

  if (!hasDetails && !includeContent) {
    return null;
  }

  const embed = applyAnnouncementDetails(
    new EmbedBuilder().setColor(APP_ACCENT),
    { title, imageUrl, footer },
  );

  if (includeContent) {
    embed.setDescription(String(content ?? ''));
  }

  return embed;
}
