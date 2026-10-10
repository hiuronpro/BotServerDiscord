import {
  AudioPlayerStatus,
  createAudioPlayer,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import { ChannelType, Events, PermissionFlagsBits } from 'discord.js';

const CONNECTION_READY_TIMEOUT_MS = 15_000;
const RECONNECT_TIMEOUT_MS = 15_000;
const voiceSessions = new Map();
const REQUIRED_VOICE_PERMISSIONS = [
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.Connect, 'Connect'],
  [PermissionFlagsBits.Speak, 'Speak'],
];

export function isSupportedVoiceChannel(channel) {
  return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice;
}

export function getMissingVoicePermissions(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);
  const requiredPermissions = channel.type === ChannelType.GuildStageVoice
    ? [...REQUIRED_VOICE_PERMISSIONS, [PermissionFlagsBits.MuteMembers, 'Mute Members']]
    : REQUIRED_VOICE_PERMISSIONS;
  return requiredPermissions
    .filter(([permission]) => !permissions?.has(permission))
    .map(([, name]) => name);
}

export function getVoiceSession(guildId) {
  return voiceSessions.get(guildId) || null;
}

export async function getCallerVoiceChannel(interaction) {
  const member = interaction.guild.members.cache.get(interaction.user.id)
    ?? await interaction.guild.members.fetch(interaction.user.id);
  const voiceChannelId = member.voice.channelId;
  if (!voiceChannelId) {
    throw new Error('Bạn cần vào một kênh thoại trước.');
  }

  const channel = interaction.guild.channels.cache.get(voiceChannelId);
  if (!isSupportedVoiceChannel(channel)) {
    throw new Error('Bạn cần ở trong kênh thoại thường hoặc Stage Channel.');
  }

  return channel;
}

async function createSession(guild, channel, botMember) {
  const missingPermissions = getMissingVoicePermissions(channel, botMember);
  if (missingPermissions.length) {
    throw new Error(`Bot đang thiếu quyền ${missingPermissions.join(', ')} tại kênh thoại.`);
  }

  const session = {
    guildId: guild.id,
    guild,
    channelId: channel.id,
    client: guild.client,
    isStageChannel: channel.type === ChannelType.GuildStageVoice,
    stageReady: channel.type !== ChannelType.GuildStageVoice,
    onStageReady: null,
    stageVoiceStateListener: null,
    connection: null,
    player: createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    }),
    queue: [],
    currentTrack: null,
    volume: 0.5,
    textChannelId: null,
    reconnectTimer: null,
    cleanupPlayback: null,
  };
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: !session.isStageChannel,
  });
  session.connection = connection;
  connection.subscribe(session.player);
  voiceSessions.set(guild.id, session);
  if (session.isStageChannel) {
    session.stageVoiceStateListener = (_oldState, newState) => {
      if (newState.id !== botMember.id || newState.channelId !== channel.id) return;

      const wasStageReady = session.stageReady;
      session.stageReady = !newState.suppress;
      if (wasStageReady && !session.stageReady && session.player.state.status === AudioPlayerStatus.Playing) {
        session.stagePlaybackPaused = Boolean(session.player.pause());
      } else if (session.stageReady && !wasStageReady) {
        if (session.stagePlaybackPaused) {
          session.player.unpause();
          session.stagePlaybackPaused = false;
        }
        session.onStageReady?.();
      }
    };
    guild.client.on(Events.VoiceStateUpdate, session.stageVoiceStateListener);
  }

  connection.on('stateChange', (_oldState, newState) => {
    if (session.destroying) return;

    if (newState.status === VoiceConnectionStatus.Ready) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
      return;
    }

    if (newState.status === VoiceConnectionStatus.Disconnected && !session.reconnectTimer) {
      connection.rejoin();
      session.reconnectTimer = setTimeout(() => {
        if (
          voiceSessions.get(session.guildId) === session
          && connection.state.status !== VoiceConnectionStatus.Ready
        ) {
          console.error(`Voice reconnect timed out for guild ${session.guildId}.`);
          destroyVoiceSession(session.guildId);
        }
      }, RECONNECT_TIMEOUT_MS);
      session.reconnectTimer.unref?.();
    }

    if (
      newState.status === VoiceConnectionStatus.Destroyed
      && voiceSessions.get(session.guildId) === session
    ) {
      disposeSession(session, false);
    }
  });
  connection.on('error', (error) => {
    console.error(`Voice connection error for guild ${guild.id}:`, error.message);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, CONNECTION_READY_TIMEOUT_MS);
    if (session.isStageChannel) {
      try {
        const voiceState = await botMember.voice.fetch();
        session.stageReady = !voiceState.suppress;
        if (voiceState.suppress) {
          await voiceState.setSuppressed(false);
          session.stageReady = true;
        }
      } catch (error) {
        console.error(`Could not request Stage speaking permission for guild ${guild.id}:`, error);
        destroyVoiceSession(guild.id);
        throw new Error('Bot đã vào Stage nhưng không thể tự lên làm diễn giả. Hãy cấp quyền Connect, Speak và Mute Members cho bot, rồi thử lại.');
      }
    }
  } catch (error) {
    if (session.destroying) throw error;
    console.error(
      `Voice connection did not become ready for guild ${guild.id}, channel ${channel.id}; state=${connection.state.status}:`,
      error,
    );
    destroyVoiceSession(guild.id);
    throw new Error('Discord không hoàn tất kết nối voice. Quyền Connect/Speak đã được kiểm tra; hãy thử lại và kiểm tra log bot nếu lỗi tiếp diễn.');
  }

  return session;
}

export async function joinVoiceSession(interaction, { allowMove = true } = {}) {
  const channel = await getCallerVoiceChannel(interaction);
  const guild = interaction.guild;
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  const missingPermissions = getMissingVoicePermissions(channel, botMember);
  if (missingPermissions.length) {
    throw new Error(`Bot đang thiếu quyền ${missingPermissions.join(', ')} tại kênh thoại.`);
  }
  const current = getVoiceSession(guild.id);
  if (current?.channelId === channel.id) {
    if (current.connection.state.status !== VoiceConnectionStatus.Ready) {
      await entersState(current.connection, VoiceConnectionStatus.Ready, CONNECTION_READY_TIMEOUT_MS);
    }
    return { session: current, moved: false, alreadyJoined: true };
  }
  if (current && !allowMove) {
    throw new Error('Bot đang ở một kênh thoại khác. Hãy dùng `/join` để chuyển bot trước.');
  }
  if (current) {
    destroyVoiceSession(guild.id);
  }

  return {
    session: await createSession(guild, channel, botMember),
    moved: Boolean(current),
    alreadyJoined: false,
  };
}

function disposeSession(session, destroyConnection) {
  if (voiceSessions.get(session.guildId) === session) {
    voiceSessions.delete(session.guildId);
  }
  session.destroying = true;
  clearTimeout(session.reconnectTimer);
  session.cleanupPlayback?.();
  session.currentTrack = null;
  session.queue.length = 0;
  if (session.stageVoiceStateListener) {
    session.client.off(Events.VoiceStateUpdate, session.stageVoiceStateListener);
  }
  session.player.stop(true);
  session.connection.removeAllListeners();
  if (destroyConnection) session.connection.destroy();
  session.player.removeAllListeners();
}

export function destroyVoiceSession(guildId) {
  const session = voiceSessions.get(guildId);
  if (!session) return false;

  disposeSession(session, true);
  return true;
}

export function destroyAllVoiceSessions() {
  for (const guildId of voiceSessions.keys()) {
    destroyVoiceSession(guildId);
  }
}

export function getVoiceSessionCount() {
  return voiceSessions.size;
}

export { AudioPlayerStatus, VoiceConnectionStatus };
