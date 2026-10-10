import dotenv from 'dotenv';

dotenv.config();

export const config = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  CLIENT_ID: process.env.CLIENT_ID || '',
  GUILD_ID: process.env.GUILD_ID || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  YT_DLP_PATH: process.env.YT_DLP_PATH || 'yt-dlp',
  DENO_PATH: process.env.DENO_PATH || 'deno',
  FFMPEG_PATH: process.env.FFMPEG_PATH || '',
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID || '',
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET || '',
  MAX_QUEUE_SIZE: readPositiveInteger(process.env.MAX_QUEUE_SIZE, 20),
  MAX_VIDEO_SECONDS: readPositiveInteger(process.env.MAX_VIDEO_MINUTES, 120) * 60,
};

function readPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}
