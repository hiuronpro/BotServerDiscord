import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import {
  clearQueuedTracks,
  enqueueAudioTracks,
  formatDuration,
  getPlayerStatus,
  joinPlayerVoice,
  leavePlayerVoice,
  pausePlayback,
  removeQueuedTrack,
  resumePlayback,
  setPlaybackVolume,
  skipPlayback,
  stopPlayback,
} from '../services/playerService.js';
import { getCallerVoiceChannel, getVoiceSession } from '../services/voiceService.js';
import { normalizeAudioUrl, resolveAudioInput } from '../services/audioSourceService.js';
import { config } from '../config/env.js';

const AUDIO_HELP = 'Hỗ trợ playlist YouTube/SoundCloud; Spotify playlist cần client credentials và phát bản tìm trên YouTube.';

async function deferPlayerReply(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

async function replyDeferredError(interaction, command, error) {
  console.error(`/${command} failed in guild ${interaction.guildId}:`, error.diagnostic || error);
  await interaction.editReply({
    content: `⚠️ ${error.message || 'Không thể thực hiện thao tác player.'}`,
    embeds: [],
    components: [],
  });
}

function queueLines(queue, offset = 0) {
  return queue.map((track, index) => (
    `**${offset + index + 1}.** [${track.title.replace(/[\[\]\\]/g, '\\$&').replace(/\s+/g, ' ')}](${track.url}) · ${formatDuration(track.duration)}${track.requestedSource === 'Spotify' ? ' · Spotify → YouTube' : ''}`
  ));
}

export async function handleMusicCommand(interaction) {
  const command = interaction.commandName;
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x6c4ab6)
      .setTitle('🎵 Trợ giúp trình phát')
      .setDescription([
        '`/join` vào kênh thoại của bạn',
        '`/play link:<URL>` phát track hoặc playlist YouTube/SoundCloud; Spotify tìm bản tương ứng trên YouTube',
        '`/pause`, `/resume`, `/nowplaying`, `/queue` quản lý bài phát',
        '`/skip`, `/remove position:<số>`, `/clear` quản lý queue',
        '`/volume volume:<0-100>`, `/stop`, `/leave` điều khiển phiên voice',
        '',
        AUDIO_HELP,
        'Chỉ phát nội dung bạn có quyền sử dụng và tuân thủ điều khoản của dịch vụ nguồn.',
      ].join('\n'))
      .setFooter({ text: `Queue tối đa ${config.MAX_QUEUE_SIZE} bài · Mỗi bài tối đa ${Math.round(config.MAX_VIDEO_SECONDS / 60)} phút` });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (command === 'join') {
    await deferPlayerReply(interaction);
    try {
      const { moved, alreadyJoined, session } = await joinPlayerVoice(interaction);
      await interaction.editReply({
        content: moved
          ? `✅ Đã chuyển bot sang <#${session.channelId}>. Queue và bài phát cũ đã được dọn.${session.isStageChannel && !session.stageReady ? ' Đang chờ bot được cấp quyền phát biểu trên Stage.' : ''}`
          : alreadyJoined
            ? `Bot đã ở trong <#${session.channelId}>.${session.isStageChannel && !session.stageReady ? ' Đang chờ quyền phát biểu trên Stage.' : ''}`
            : `✅ Bot đã vào <#${session.channelId}>.${session.isStageChannel && !session.stageReady ? ' Đang chờ quyền phát biểu trên Stage.' : ''}`,
      });
    } catch (error) {
      await replyDeferredError(interaction, command, error);
    }
    return;
  }

  if (command === 'play') {
    const input = interaction.options.getString('link', true);
    try {
      normalizeAudioUrl(input);
    } catch (error) {
      await interaction.reply({
        content: error.message,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await deferPlayerReply(interaction);
    try {
      const callerChannel = await getCallerVoiceChannel(interaction);
      const existingSession = getVoiceSession(interaction.guildId);
      if (existingSession && existingSession.channelId !== callerChannel.id) {
        throw new Error('Bot đang ở một kênh thoại khác. Hãy dùng `/join` để chuyển bot trước.');
      }
      const { session } = await joinPlayerVoice(interaction);
      await interaction.editReply({
        content: session.isStageChannel && !session.stageReady
          ? 'Đã vào Stage và đang chờ quyền phát biểu; đang xử lý link nhạc...'
          : `Đã vào <#${session.channelId}>. Đang xử lý link nhạc...`,
        embeds: [],
        components: [],
      });
      const currentStatus = getPlayerStatus(interaction.guildId);
      const currentSize = (currentStatus?.queue.length || 0) + Number(Boolean(currentStatus?.currentTrack));
      const availableSlots = config.MAX_QUEUE_SIZE - currentSize;
      const resolved = await resolveAudioInput(input, { limit: availableSlots });
      const { position, started } = await enqueueAudioTracks(interaction, resolved.tracks);
      const firstTrack = resolved.tracks[0];
      const stagePending = callerChannel.type === ChannelType.GuildStageVoice
        && !getVoiceSession(interaction.guildId)?.stageReady;
      const playlistDescription = resolved.isPlaylist
        ? [
          `Playlist **${resolved.playlistTitle}** · đã thêm **${resolved.tracks.length} bài** vào queue.`,
          firstTrack.requestedSource === 'Spotify'
            ? 'Spotify không phát audio trực tiếp; mỗi bài là bản tìm trên YouTube và có thể khác bản gốc.'
            : '',
          ...resolved.tracks.slice(0, 5).map((track, index) => (
            `${index + 1}. [${track.title.replace(/[\[\]\\]/g, '\\$&').replace(/\s+/g, ' ')}](${track.url})`
          )),
          resolved.tracks.length > 5 ? `…và ${resolved.tracks.length - 5} bài khác.` : '',
          resolved.skippedCount ? `⚠️ Bỏ qua ${resolved.skippedCount} bài không lấy được metadata hoặc không thể phát.` : '',
          ...resolved.skippedReasons.map((reason) => `• ${reason.slice(0, 250)}`),
        ].filter(Boolean).join('\n')
        : [
          `[${firstTrack.title.replace(/[\[\]\\]/g, '\\$&').replace(/\s+/g, ' ')}](${firstTrack.url})`,
          firstTrack.requestedSource === 'Spotify'
            ? `Bản YouTube được tìm theo track Spotify: **${firstTrack.matchedFrom}**. Có thể không phải bản phát hành chính thức.`
            : '',
        ].filter(Boolean).join('\n');
      const embed = new EmbedBuilder()
        .setColor(0x6c4ab6)
        .setTitle(resolved.isPlaylist
          ? '📚 Đã thêm playlist vào queue'
          : started ? '🎵 Đang phát nhạc' : '➕ Đã thêm nhạc vào queue')
        .setDescription([
          playlistDescription,
          stagePending
            ? 'Bot chưa có quyền phát biểu trên Stage nên bài nhạc đang chờ.'
            : '',
        ].filter(Boolean).join('\n'))
        .addFields(
          {
            name: 'Nguồn phát',
            value: resolved.isPlaylist
              ? (firstTrack.requestedSource === 'Spotify' ? 'YouTube (tìm từ Spotify playlist)' : firstTrack.source)
              : firstTrack.requestedSource === 'Spotify' ? 'YouTube (tìm từ Spotify)' : firstTrack.source,
            inline: true,
          },
          {
            name: resolved.isPlaylist ? 'Số bài' : 'Thời lượng',
            value: resolved.isPlaylist
              ? `${resolved.tracks.length}${resolved.skippedCount ? ` (bỏ qua ${resolved.skippedCount})` : ''}`
              : formatDuration(firstTrack.duration),
            inline: true,
          },
          {
            name: 'Vị trí trong queue',
            value: started ? 'Đang phát' : String(position),
            inline: true,
          },
        )
        .setFooter({ text: AUDIO_HELP });
      const openTrack = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(resolved.isPlaylist ? 'Mở playlist gốc' : `Mở ${firstTrack.requestedSource === 'Spotify' ? 'bản YouTube' : firstTrack.source}`)
          .setStyle(ButtonStyle.Link)
          .setURL(resolved.isPlaylist ? normalizeAudioUrl(input) : firstTrack.url),
      );
      if (!resolved.isPlaylist && firstTrack.requestedSource === 'Spotify') {
        openTrack.addComponents(
          new ButtonBuilder()
            .setLabel('Link Spotify gốc')
            .setStyle(ButtonStyle.Link)
            .setURL(firstTrack.requestedUrl),
        );
      }
      await interaction.editReply({ embeds: [embed], components: [openTrack] });
    } catch (error) {
      await replyDeferredError(interaction, command, error);
    }
    return;
  }

  if (command === 'nowplaying') {
    const status = getPlayerStatus(interaction.guildId);
    if (!status?.currentTrack) {
      await interaction.reply({
        content: status ? 'Hiện không có bài nào đang phát.' : 'Bot chưa tham gia kênh thoại.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const track = status.currentTrack;
    const activePlaybackMs = track.playbackSegmentStartedAt
      ? Date.now() - track.playbackSegmentStartedAt
      : 0;
    const elapsed = Math.floor(((track.playbackElapsedMs || 0) + activePlaybackMs) / 1_000);
    const embed = new EmbedBuilder()
      .setColor(0x6c4ab6)
      .setTitle('🎶 Đang phát')
      .setDescription(`[${track.title.replace(/[\[\]\\]/g, '\\$&').replace(/\s+/g, ' ')}](${track.url})`)
      .addFields(
        { name: 'Tiến độ', value: `${formatDuration(elapsed)} / ${formatDuration(track.duration)}`, inline: true },
        {
          name: 'Nguồn',
          value: track.requestedSource === 'Spotify' ? 'YouTube (tìm từ Spotify)' : track.source,
          inline: true,
        },
        { name: 'Âm lượng', value: `${status.volume}%`, inline: true },
      )
      .setFooter({ text: AUDIO_HELP });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (command === 'queue') {
    const status = getPlayerStatus(interaction.guildId);
    if (!status) {
      await interaction.reply({ content: 'Bot chưa tham gia kênh thoại.', flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = [];
    const queuedPages = Math.max(1, Math.ceil(status.queue.length / 10));
    const page = interaction.options.getInteger('page') || 1;
    if (page > queuedPages) {
      await interaction.reply({
        content: `Queue chỉ có ${queuedPages} trang.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (status.currentTrack && page === 1) {
      const title = status.currentTrack.title.replace(/[\[\]\\]/g, '\\$&').replace(/\s+/g, ' ');
      lines.push(`▶️ **Đang phát:** [${title}](${status.currentTrack.url}) · ${formatDuration(status.currentTrack.duration)}`);
    }
    const queueOffset = (page - 1) * 10;
    lines.push(...queueLines(status.queue.slice(queueOffset, queueOffset + 10), queueOffset));
    const visibleCount = Math.min(status.queue.length - queueOffset, 10) + Number(Boolean(status.currentTrack && page === 1));
    const description = lines.length
      ? lines.join('\n')
      : 'Queue đang trống.';
    const embed = new EmbedBuilder()
      .setColor(0x6c4ab6)
      .setTitle(`📜 Queue · ${status.queue.length} bài đang chờ`)
      .setDescription(description)
      .setFooter({ text: `Trang ${page}/${queuedPages} · ${visibleCount} bài · Dùng /remove để gỡ theo vị trí queue` });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (command === 'pause') {
    await interaction.reply({
      content: pausePlayback(interaction.guildId) ? '⏸️ Đã tạm dừng.' : 'Không có bài đang phát để tạm dừng.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (command === 'resume') {
    await interaction.reply({
      content: resumePlayback(interaction.guildId) ? '▶️ Đã tiếp tục phát.' : 'Player không ở trạng thái tạm dừng.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (command === 'skip') {
    await deferPlayerReply(interaction);
    try {
      const startedNext = await skipPlayback(interaction.guildId);
      await interaction.editReply({
        content: startedNext ? '⏭️ Đã bỏ qua; bài tiếp theo đang phát.' : 'Đã bỏ qua bài hiện tại; queue không còn bài tiếp theo.',
      });
    } catch (error) {
      await replyDeferredError(interaction, command, error);
    }
    return;
  }

  if (command === 'remove') {
    const position = interaction.options.getInteger('position', true);
    const removed = removeQueuedTrack(interaction.guildId, position);
    await interaction.reply({
      content: removed ? `🗑️ Đã xóa **${removed.title}** khỏi queue.` : 'Vị trí không hợp lệ hoặc queue đang trống.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (command === 'clear') {
    const removed = clearQueuedTracks(interaction.guildId);
    await interaction.reply({
      content: removed ? `🧹 Đã xóa ${removed} bài nhạc đang chờ. Bài hiện tại vẫn tiếp tục phát.` : 'Queue không có bài nhạc đang chờ.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (command === 'volume') {
    const volume = interaction.options.getInteger('volume', true);
    const updated = setPlaybackVolume(interaction.guildId, volume);
    await interaction.reply({
      content: updated
        ? `🔊 Đã đặt âm lượng phiên phát thành ${volume}%.`
        : 'Bot chưa tham gia kênh thoại.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (command === 'stop') {
    const stopped = stopPlayback(interaction.guildId);
    await interaction.reply({
      content: stopped ? '⏹️ Đã dừng bài hiện tại; bot vẫn ở trong kênh thoại và queue được giữ lại.' : 'Hiện không có bài đang phát.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (command === 'leave') {
    const left = leavePlayerVoice(interaction.guildId);
    await interaction.reply({
      content: left ? '👋 Đã dừng phát, xóa queue và rời kênh thoại.' : 'Bot chưa tham gia kênh thoại.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
