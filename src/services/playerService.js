import {
  AudioPlayerStatus,
  createAudioResource,
  entersState,
  StreamType,
} from '@discordjs/voice';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { config } from '../config/env.js';
import { getAudioSourceFailureMessage, spawnAudioStream } from './audioSourceService.js';
import {
  destroyAllVoiceSessions,
  destroyVoiceSession,
  getVoiceSession,
  joinVoiceSession,
} from './voiceService.js';

const PLAYBACK_START_TIMEOUT_MS = 15_000;
const STDERR_LIMIT = 4_096;

function appendBounded(current, chunk) {
  const value = current + chunk.toString('utf8');
  return value.length > STDERR_LIMIT ? value.slice(-STDERR_LIMIT) : value;
}

function cleanupTrack(track) {
  if (!track || track.cleaned) return;
  track.cleaned = true;
  clearTimeout(track.startTimer);
  track.resource?.playStream.destroy();
  if (track.child && !track.child.killed) track.child.kill();
}

function formatDuration(seconds) {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainder = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function buildNowPlayingNotice(track) {
  const title = String(track.title || 'Track audio')
    .replace(/[\[\]\\]/g, '\\$&')
    .replace(/\s+/g, ' ');
  const source = track.requestedSource === 'Spotify'
    ? 'YouTube (tìm từ Spotify)'
    : track.source;
  const embed = new EmbedBuilder()
    .setColor(0x6c4ab6)
    .setTitle('🎶 Đang phát nhạc')
    .setDescription(`[${title}](${track.url})`)
    .addFields(
      { name: 'Nguồn', value: source || 'Không rõ', inline: true },
      { name: 'Thời lượng', value: formatDuration(track.duration), inline: true },
      {
        name: 'Yêu cầu bởi',
        value: track.requestedBy ? `<@${track.requestedBy}>` : 'Không rõ',
        inline: true,
      },
    );
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(track.requestedSource === 'Spotify' ? 'Mở bản YouTube' : `Mở ${track.source || 'bài hát'}`)
      .setStyle(ButtonStyle.Link)
      .setURL(track.url),
  );
  if (track.requestedSource === 'Spotify' && track.requestedUrl) {
    buttons.addComponents(
      new ButtonBuilder()
        .setLabel('Spotify gốc')
        .setStyle(ButtonStyle.Link)
        .setURL(track.requestedUrl),
    );
  }
  return { embeds: [embed], components: [buttons] };
}

export async function notifySession(session, content) {
  if (!session.textChannelId) return;
  try {
    const channel = session.guild.channels.cache.get(session.textChannelId)
      ?? await session.guild.channels.fetch(session.textChannelId);
    if (!channel?.isTextBased()) {
      throw new Error(`Channel ${session.textChannelId} is not a text channel.`);
    }
    const payload = typeof content === 'string' ? { content } : content;
    await channel.send({ ...payload, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error(`Unable to post player status for guild ${session.guildId}:`, error.message);
  }
}

function trackFailureMessage(track, error) {
  if (error?.code === 'ENOENT') {
    return 'Không tìm thấy yt-dlp. Hãy cài yt-dlp và thêm vào PATH của máy chạy bot.';
  }
  if (error?.message?.includes('FFmpeg/avconv not found')) {
    return 'Không tìm thấy FFmpeg. Hãy cài FFmpeg và thêm vào PATH của máy chạy bot.';
  }
  return `${getAudioSourceFailureMessage(track.stderr, track.source)} Track: "${track.title}".`;
}

function attachPlayerLifecycle(session) {
  if (session.playerLifecycleAttached) return;
  session.playerLifecycleAttached = true;

  session.cleanupPlayback = () => {
    cleanupTrack(session.currentTrack);
    session.currentTrack = null;
  };
  session.onStageReady = () => {
    if (session.currentTrack) return;
    void startNextTrack(session).catch((error) => {
      console.error(`Stage queue playback failed for guild ${session.guildId}:`, error.message);
      void notifySession(session, `⚠️ ${error.message}`);
    });
  };

  session.player.on('stateChange', (oldState, newState) => {
    if (session.destroying) return;

    if (newState.status === AudioPlayerStatus.Playing && session.currentTrack) {
      const track = session.currentTrack;
      track.started = true;
      track.startedAt ||= Date.now();
      track.playbackSegmentStartedAt = Date.now();
      if (!track.nowPlayingNotified) {
        track.nowPlayingNotified = true;
        void notifySession(session, buildNowPlayingNotice(track));
      }
    } else if (
      oldState.status === AudioPlayerStatus.Playing
      && session.currentTrack?.playbackSegmentStartedAt
    ) {
      session.currentTrack.playbackElapsedMs += Date.now() - session.currentTrack.playbackSegmentStartedAt;
      session.currentTrack.playbackSegmentStartedAt = null;
    }

    if (
      newState.status === AudioPlayerStatus.Idle
      && oldState.status !== AudioPlayerStatus.Idle
      && session.currentTrack?.started
    ) {
      const finishedTrack = session.currentTrack;
      session.currentTrack = null;
      cleanupTrack(finishedTrack);
      void startNextTrack(session).catch((error) => {
        console.error(`Queue playback failed for guild ${session.guildId}:`, error.message);
        void notifySession(session, `⚠️ ${error.message}`);
      });
    }
  });

  session.player.on('error', (error) => {
    if (session.destroying) return;
    const track = session.currentTrack;
    if (!track) {
      console.error(`Audio player error in guild ${session.guildId}:`, error.message);
      return;
    }

    if (!track.started) {
      track.rejectProcessFailure(error);
      return;
    }

    void failCurrentTrack(session, track, error);
  });
};

async function failCurrentTrack(session, track, error) {
  if (session.destroying || session.currentTrack !== track) return;

  session.currentTrack = null;
  cleanupTrack(track);
  session.player.stop(true);
  const message = trackFailureMessage(track, error);
  console.error(`Playback failed in guild ${session.guildId}: ${message}`, {
    ytDlpStderr: track.stderr || null,
    cause: error.message,
  });
  await notifySession(session, `⚠️ ${message}`);
  try {
    await startNextTrack(session);
  } catch (queueError) {
    console.error(`Could not continue queue in guild ${session.guildId}:`, queueError.message);
    await notifySession(session, `⚠️ ${queueError.message}`);
  }
}

async function startTrack(session, track) {
  session.currentTrack = track;
  track.started = false;
  track.stderr = '';
  track.child = spawnAudioStream(track.url);
  track.processFailure = new Promise((_, reject) => {
    track.rejectProcessFailure = reject;
  });
  track.processFailure.catch(() => {});
  track.child.stderr.on('data', (chunk) => {
    track.stderr = appendBounded(track.stderr, chunk);
  });
  track.child.once('error', (error) => {
    if (track.started) {
      void failCurrentTrack(session, track, error);
    } else {
      track.rejectProcessFailure(error);
    }
  });
  track.child.once('close', (code) => {
    if (code && session.currentTrack === track) {
      const error = new Error(`yt-dlp exited with code ${code}`);
      if (track.started) {
        void failCurrentTrack(session, track, error);
      } else {
        track.rejectProcessFailure(error);
      }
    }
  });

  track.resource = createAudioResource(track.child.stdout, {
    inputType: StreamType.Arbitrary,
    inlineVolume: true,
    metadata: track,
  });
  track.resource.volume.setVolume(session.volume);
  track.child.stdout.on('error', (error) => {
    if (track.started) {
      void failCurrentTrack(session, track, error);
    } else {
      track.rejectProcessFailure(error);
    }
  });
  session.player.play(track.resource);
  await Promise.race([
    entersState(session.player, AudioPlayerStatus.Playing, PLAYBACK_START_TIMEOUT_MS),
    track.processFailure,
  ]);
  track.started = true;
  track.startedAt ||= Date.now();
}

async function pumpQueue(session) {
  let firstFailure = null;
  while (session.queue.length) {
    const track = session.queue.shift();
    try {
      await startTrack(session, track);
      return track;
    } catch (error) {
      if (session.currentTrack === track) session.currentTrack = null;
      cleanupTrack(track);
      session.player.stop(true);
      const message = trackFailureMessage(track, error);
      firstFailure ||= Object.assign(new Error(message, { cause: error }), {
        diagnostic: track.stderr || error.diagnostic || error.message,
      });
      console.error(`Unable to start audio track in guild ${session.guildId}: ${message}`, {
        ytDlpStderr: track.stderr || null,
        cause: error.message,
      });
    }
  }
  if (firstFailure) throw firstFailure;
  return null;
}

function startNextTrack(session) {
  if (session.isStageChannel && !session.stageReady) {
    return Promise.resolve(null);
  }
  if (session.startPromise) return session.startPromise;
  session.startPromise = pumpQueue(session).finally(() => {
    session.startPromise = null;
  });
  return session.startPromise;
}

export async function joinPlayerVoice(interaction) {
  const { session, moved } = await joinVoiceSession(interaction);
  attachPlayerLifecycle(session);
  session.textChannelId = interaction.channelId;
  return { session, moved };
}

export async function enqueueAudioTracks(interaction, infos) {
  if (!Array.isArray(infos) || infos.length === 0) {
    throw new Error('Không có bài hợp lệ để thêm vào queue.');
  }
  const { session } = await joinVoiceSession(interaction, { allowMove: false });
  attachPlayerLifecycle(session);
  session.textChannelId = interaction.channelId;

  const currentSize = session.queue.length + Number(Boolean(session.currentTrack));
  const availableSlots = config.MAX_QUEUE_SIZE - currentSize;
  if (infos.length > availableSlots) {
    throw new Error(`Queue chỉ còn ${Math.max(0, availableSlots)} chỗ trống; yêu cầu có ${infos.length} bài.`);
  }

  const tracks = infos.map((info) => ({
    ...info,
    requestedBy: interaction.user.id,
    addedAt: Date.now(),
    resource: null,
    child: null,
    stderr: '',
    started: false,
    playbackElapsedMs: 0,
    playbackSegmentStartedAt: null,
    cleaned: false,
  }));
  session.queue.push(...tracks);
  if (session.currentTrack || session.startPromise || (session.isStageChannel && !session.stageReady)) {
    return {
      session,
      tracks,
      position: session.queue.indexOf(tracks[0]) + 1,
      started: false,
    };
  }

  try {
    const startedTrack = await startNextTrack(session);
    return {
      session,
      tracks,
      position: startedTrack ? 0 : session.queue.indexOf(tracks[0]) + 1,
      started: Boolean(startedTrack),
    };
  } catch (error) {
    session.queue = session.queue.filter((queuedTrack) => !tracks.includes(queuedTrack));
    throw error;
  }
}

export async function enqueueAudioTrack(interaction, info) {
  const result = await enqueueAudioTracks(interaction, [info]);
  return { ...result, track: result.tracks[0] };
}

export function getPlayerStatus(guildId) {
  const session = getVoiceSession(guildId);
  if (!session) return null;
  return {
    session,
    currentTrack: session.currentTrack,
    queue: [...session.queue],
    playerStatus: session.player.state.status,
    volume: Math.round(session.volume * 100),
  };
}

export function pausePlayback(guildId) {
  const session = getVoiceSession(guildId);
  return Boolean(session?.player.pause());
}

export function resumePlayback(guildId) {
  const session = getVoiceSession(guildId);
  return Boolean(session?.player.unpause());
}

export async function skipPlayback(guildId) {
  const session = getVoiceSession(guildId);
  if (!session) return false;
  if (!session.currentTrack) return Boolean(await startNextTrack(session));

  const track = session.currentTrack;
  session.currentTrack = null;
  cleanupTrack(track);
  session.player.stop(true);
  return Boolean(await startNextTrack(session));
}

export function stopPlayback(guildId) {
  const session = getVoiceSession(guildId);
  if (!session?.currentTrack) return false;

  const track = session.currentTrack;
  session.currentTrack = null;
  cleanupTrack(track);
  session.player.stop(true);
  return true;
}

export function removeQueuedTrack(guildId, position) {
  const session = getVoiceSession(guildId);
  if (!session || !Number.isInteger(position) || position < 1 || position > session.queue.length) {
    return null;
  }
  return removeQueueItem(session.queue, position);
}

export function removeQueueItem(queue, position) {
  if (!Array.isArray(queue) || !Number.isInteger(position) || position < 1 || position > queue.length) {
    return null;
  }
  return queue.splice(position - 1, 1)[0];
}

export function clearQueuedTracks(guildId) {
  const session = getVoiceSession(guildId);
  if (!session) return 0;
  const removed = session.queue.length;
  session.queue.length = 0;
  return removed;
}

export function setPlaybackVolume(guildId, volume) {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    throw new Error('Âm lượng phải là số nguyên từ 0 đến 100.');
  }
  const session = getVoiceSession(guildId);
  if (!session) return false;

  session.volume = volume / 100;
  session.currentTrack?.resource?.volume?.setVolume(session.volume);
  return true;
}

export function leavePlayerVoice(guildId) {
  return destroyVoiceSession(guildId);
}

export function shutdownPlayer() {
  destroyAllVoiceSessions();
}

export { formatDuration };
