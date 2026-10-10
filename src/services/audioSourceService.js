import { spawn } from 'node:child_process';
import { config } from '../config/env.js';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);
const SOUNDCLOUD_HOSTS = new Set([
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
]);
const SPOTIFY_HOSTS = new Set(['open.spotify.com', 'www.open.spotify.com']);
const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const METADATA_TIMEOUT_MS = 20_000;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_SPOTIFY_RESPONSE_BYTES = 2 * 1024 * 1024;
const PLAYLIST_RESOLUTION_CONCURRENCY = 3;
const STDERR_LIMIT = 4_096;
const activeProcesses = new Set();
let spotifyToken = null;

function javascriptRuntimeArgs() {
  return [];
}

function parseAudioUrl(input) {
  if (typeof input !== 'string' || input.length > 2_000) {
    throw new Error('Hãy nhập liên kết YouTube, SoundCloud hoặc Spotify hợp lệ.');
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Hãy nhập liên kết YouTube, SoundCloud hoặc Spotify hợp lệ.');
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
  ) {
    throw new Error('Chỉ chấp nhận liên kết HTTPS từ YouTube, SoundCloud hoặc Spotify.');
  }

  const hostname = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(hostname)) {
    return { url, source: 'YouTube' };
  }

  if (SOUNDCLOUD_HOSTS.has(hostname)) {
    return { url, source: 'SoundCloud' };
  }
  if (SPOTIFY_HOSTS.has(hostname)) {
    return { url, source: 'Spotify' };
  }

  throw new Error('Nguồn chưa được hỗ trợ. Hãy dùng link YouTube, SoundCloud hoặc Spotify.');
}

function getYoutubeVideoId(url, hostname) {
  if (hostname === 'youtu.be') {
    return url.pathname.split('/').filter(Boolean)[0];
  }
  if (url.pathname === '/watch') {
    return url.searchParams.get('v');
  }
  return url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
}

export function normalizeAudioUrl(input) {
  const { url, source } = parseAudioUrl(input);
  const hostname = url.hostname.toLowerCase();
  if (source === 'Spotify') {
    const match = url.pathname.match(/^\/(?:intl-[a-z]{2}(?:-[A-Z]{2})?\/)?(track|playlist)\/([A-Za-z0-9]{22})\/?$/);
    if (!match) {
      throw new Error('Spotify chỉ hỗ trợ link track hoặc playlist công khai; album chưa được hỗ trợ.');
    }
    return `https://open.spotify.com/${match[1]}/${match[2]}`;
  }
  if (source === 'SoundCloud') {
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length === 3 && pathParts[1] === 'sets' && !url.searchParams.has('in')) {
      return `https://soundcloud.com/${pathParts[0]}/sets/${pathParts[2]}`;
    }
    if (url.searchParams.has('in') || pathParts.includes('sets')) {
      throw new Error('Link SoundCloud không đúng định dạng track hoặc playlist.');
    }
    if (
      pathParts.length < 2
      || pathParts.length > 3
      || (pathParts.length === 3 && !pathParts[2].startsWith('s-'))
    ) {
      throw new Error('Hãy gửi link của một track SoundCloud riêng lẻ.');
    }
    return url.toString();
  }

  const playlistId = url.searchParams.get('list');
  const videoId = getYoutubeVideoId(url, hostname);
  if (playlistId?.startsWith('RD')) {
    if (videoId && VIDEO_ID_PATTERN.test(videoId)) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
    throw new Error('YouTube Mix/Radio không cho phép tải toàn bộ danh sách. Hãy gửi link một video cụ thể trong Mix.');
  }
  if (url.pathname === '/playlist' || playlistId) {
    if (!playlistId || !/^[\w-]{1,128}$/.test(playlistId)) {
      throw new Error('Link playlist YouTube không chứa mã playlist hợp lệ.');
    }
    return `https://www.youtube.com/playlist?list=${playlistId}`;
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error('Liên kết không chứa mã video YouTube hợp lệ.');
  }

  return `https://www.youtube.com/watch?v=${videoId}`;
}

function appendBounded(current, chunk, limit) {
  const value = current + chunk.toString('utf8');
  return value.length > limit ? value.slice(-limit) : value;
}

export function getAudioSourceFailureMessage(stderr, source = 'nguồn audio') {
  const normalized = String(stderr || '').toLowerCase();
  if (/no supported javascript runtime|javascript runtime.*(?:not found|missing)|deno.*(?:not found|missing)/.test(normalized)) {
    return 'Thiếu Deno trên máy chạy bot. Hãy cài Deno và bảo đảm lệnh deno có trong PATH.';
  }
  if (/sign in to confirm you(?:'|’)re not a bot|confirm you(?:'|’)re not a bot/.test(normalized)) {
    return 'YouTube đang từ chối yêu cầu từ máy chủ bot. Thử lại sau hoặc kiểm tra IP/mạng máy chủ.';
  }
  if (/nsig extraction failed|signature extraction failed|challenge solving failed|no challenge solver/.test(normalized)) {
    return `yt-dlp không giải được thử thách của ${source}. Hãy cập nhật yt-dlp và kiểm tra Deno.`;
  }
  if (/http error 429|too many requests|rate.?limit/.test(normalized)) {
    return `${source} đang giới hạn số yêu cầu từ mạng này. Hãy đợi một lúc rồi thử lại.`;
  }
  if (/http error 403|forbidden/.test(normalized)) {
    return `${source} từ chối tải luồng audio (HTTP 403). Hãy cập nhật yt-dlp và thử lại; nếu còn lỗi, mạng/IP hiện tại có thể bị chặn.`;
  }
  if (/private video|members.only|login required|sign in to confirm your age/.test(normalized)) {
    return 'Track riêng tư, chỉ dành cho thành viên hoặc yêu cầu đăng nhập; bot không thể phát.';
  }
  if (/age.restricted|age.?gate|confirm your age/.test(normalized)) {
    return 'Track bị giới hạn độ tuổi và không thể phát bằng bot.';
  }
  if (/region|country|geo.?restrict/.test(normalized)) {
    return 'Video bị giới hạn tại khu vực hiện tại.';
  }
  if (/requested format is not available|no video formats found/.test(normalized)) {
    return `${source} không cung cấp định dạng audio có thể phát cho track này.`;
  }
  if (/playlist type is unviewable|this playlist type is unviewable/.test(normalized)) {
    return 'YouTube Mix/Radio không cho bot đọc toàn bộ danh sách. Hãy gửi link video cụ thể thay vì link Mix/Radio.';
  }
  if (/not available|video unavailable|removed|deleted|does not exist/.test(normalized)) {
    return `Track không tồn tại hoặc không còn truy cập được trên ${source}.`;
  }
  if (/unable to download webpage|connection timed out|timed out|temporary failure in name resolution|network is unreachable|connection refused/.test(normalized)) {
    return `Máy chạy bot không kết nối được tới ${source}. Hãy kiểm tra mạng rồi thử lại.`;
  }
  return `Không thể lấy thông tin hoặc luồng audio từ ${source}. Xem log bot để biết lỗi yt-dlp chi tiết.`;
}

function metadataFailure(stderr, source) {
  const detail = stderr.trim().replace(/\s+/g, ' ').slice(-500);
  const error = new Error(getAudioSourceFailureMessage(detail, source));
  error.diagnostic = detail;
  return error;
}

function trackProcess(child) {
  activeProcesses.add(child);
  child.once('close', () => activeProcesses.delete(child));
  child.once('error', () => activeProcesses.delete(child));
}

function runYtDlpJson(args, source) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.YT_DLP_PATH, args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackProcess(child);

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error(`${source} không phản hồi kịp thời. Hãy thử lại sau.`));
    }, METADATA_TIMEOUT_MS);
    timeout.unref?.();

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout, 'utf8') > MAX_METADATA_BYTES) {
        child.kill();
        finish(new Error('Dữ liệu video vượt giới hạn an toàn.'));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk, STDERR_LIMIT);
    });
    child.once('error', (error) => {
      if (error.code === 'ENOENT') {
        finish(new Error('Không tìm thấy yt-dlp. Hãy cài yt-dlp và thêm vào PATH.'));
        return;
      }
      finish(new Error('Không thể khởi chạy yt-dlp.'));
    });
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(metadataFailure(stderr, source));
        return;
      }

      try {
        finish(null, JSON.parse(stdout));
      } catch {
        finish(new Error('yt-dlp trả về dữ liệu video không hợp lệ.'));
      }
    });
  });
}

function runMetadataProcess(url, source) {
  return runYtDlpJson([
    '--no-warnings',
    '--no-playlist',
    ...javascriptRuntimeArgs(),
    '--skip-download',
    '--dump-single-json',
    '--socket-timeout',
    '10',
    '--',
    url,
  ], source);
}

async function getSpotifyTrackTitle(url) {
  let response;
  try {
    response = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) },
    );
  } catch (error) {
    throw new Error(`Không thể kết nối Spotify để đọc tên track: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(response.status === 404
      ? 'Track Spotify không tồn tại hoặc không công khai.'
      : `Spotify không trả metadata (HTTP ${response.status}).`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 64 * 1024) {
    throw new Error('Metadata Spotify vượt giới hạn an toàn.');
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > 64 * 1024) {
    throw new Error('Metadata Spotify vượt giới hạn an toàn.');
  }
  let metadata;
  try {
    metadata = JSON.parse(body);
  } catch {
    throw new Error('Spotify trả metadata không hợp lệ.');
  }
  const title = typeof metadata.title === 'string' ? metadata.title.trim() : '';
  if (!title || title.length > 300) {
    throw new Error('Không đọc được tên track từ Spotify.');
  }
  return title;
}

async function searchYoutubeTrack(title, artist = '') {
  const searchTerms = [title, artist].filter(Boolean).join(' ');
  const searchUrl = `ytsearch1:${searchTerms} audio`;
  const result = await runYtDlpJson([
    '--no-warnings',
    '--flat-playlist',
    '--ignore-errors',
    '--skip-download',
    '--dump-single-json',
    '--socket-timeout',
    '10',
    '--',
    searchUrl,
  ], 'YouTube');
  const entry = result.entries?.find((candidate) => candidate?.id);
  if (!entry || !/^[\w-]{11}$/.test(entry.id)) {
    throw new Error(`Không tìm thấy bản audio YouTube tương ứng với "${title}".`);
  }
  return {
    url: `https://www.youtube.com/watch?v=${entry.id}`,
    matchedFrom: [artist, title].filter(Boolean).join(' - '),
  };
}

async function getSpotifyAccessToken() {
  if (spotifyToken && spotifyToken.expiresAt > Date.now() + 60_000) {
    return spotifyToken.value;
  }
  if (!config.SPOTIFY_CLIENT_ID || !config.SPOTIFY_CLIENT_SECRET) {
    throw new Error('Để phát playlist Spotify, hãy cấu hình SPOTIFY_CLIENT_ID và SPOTIFY_CLIENT_SECRET trong biến môi trường bot.');
  }

  let response;
  try {
    response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.SPOTIFY_CLIENT_ID}:${config.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Không thể kết nối Spotify để lấy token: ${error.message}`);
  }
  const body = await readBoundedResponse(response, 'Spotify', MAX_SPOTIFY_RESPONSE_BYTES);
  if (!response.ok) {
    throw new Error(`Spotify không cấp token playlist (HTTP ${response.status}): ${body.slice(0, 300)}`);
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('Spotify trả token không hợp lệ.');
  }
  if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) {
    throw new Error('Spotify trả token không hợp lệ.');
  }
  spotifyToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1_000,
  };
  return spotifyToken.value;
}

async function readBoundedResponse(response, source, maxBytes) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new Error(`${source} trả dữ liệu vượt giới hạn an toàn.`);
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    throw new Error(`${source} trả dữ liệu vượt giới hạn an toàn.`);
  }
  return body;
}

export function getSpotifyPlaylistApiErrorMessage(status, body) {
  if (/active premium subscription required for the owner of the app/i.test(body)) {
    return 'Spotify yêu cầu tài khoản sở hữu ứng dụng trong Developer Dashboard có gói Premium đang hoạt động để đọc playlist. Sau khi đăng ký hoặc gia hạn Premium, Spotify có thể cần vài giờ để cập nhật quyền API.';
  }
  if (status === 403) {
    return 'Spotify từ chối truy cập playlist. Hãy kiểm tra playlist có công khai và ứng dụng Spotify có quyền truy cập API.';
  }
  if (status === 404) {
    return 'Playlist Spotify không tồn tại hoặc không công khai.';
  }
  return `Không thể đọc playlist Spotify (HTTP ${status}): ${body.slice(0, 300)}`;
}

async function getSpotifyPlaylistTracks(playlistUrl, limit) {
  const token = await getSpotifyAccessToken();
  const playlistId = new URL(playlistUrl).pathname.split('/').at(-1);
  const tracks = [];
  let offset = 0;

  while (tracks.length < limit) {
    const pageSize = Math.min(50, limit - tracks.length);
    const url = new URL(`https://api.spotify.com/v1/playlists/${playlistId}/items`);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    let response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`Không thể tải danh sách bài Spotify: ${error.message}`);
    }
    const body = await readBoundedResponse(response, 'Spotify', MAX_SPOTIFY_RESPONSE_BYTES);
    if (!response.ok) {
      throw new Error(getSpotifyPlaylistApiErrorMessage(response.status, body));
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error('Spotify trả danh sách playlist không hợp lệ.');
    }
    const pageTracks = (Array.isArray(data.items) ? data.items : [])
      .map((item) => item.track)
      .filter((track) => (
        track?.type === 'track'
        && !track.is_local
        && typeof track.name === 'string'
        && Array.isArray(track.artists)
      ));
    tracks.push(...pageTracks);
    if (!data.next || !data.items?.length) break;
    offset += data.items.length;
  }

  return tracks.slice(0, limit);
}

async function resolveSingleTrack(requestedUrl, requestedSource, spotifyTitle = null) {
  let normalizedUrl = requestedUrl;
  let source = requestedSource;

  if (requestedSource === 'Spotify') {
    const match = await searchYoutubeTrack(spotifyTitle);
    normalizedUrl = match.url;
    spotifyTitle = match.matchedFrom;
    source = 'YouTube';
  }

  const info = await runMetadataProcess(normalizedUrl, source);
  if (['playlist', 'multi_video'].includes(info._type) || Array.isArray(info.entries)) {
    throw new Error('URL track lại trỏ tới playlist; không thể thêm làm một bài đơn.');
  }
  if (info.is_live || ['is_live', 'is_upcoming', 'post_live'].includes(info.live_status)) {
    throw new Error(`Chưa hỗ trợ livestream từ ${source}.`);
  }
  if (!Number.isFinite(info.duration) || info.duration <= 0) {
    throw new Error('Không xác định được thời lượng track.');
  }
  if (info.duration > config.MAX_VIDEO_SECONDS) {
    throw new Error(`Track vượt quá giới hạn ${Math.round(config.MAX_VIDEO_SECONDS / 60)} phút.`);
  }

  return {
    id: info.id,
    title: String(info.title || 'Track audio').slice(0, 250),
    duration: info.duration,
    url: normalizedUrl,
    source,
    requestedSource,
    requestedUrl,
    matchedFrom: spotifyTitle,
  };
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { value: await callback(items[index], index), error: null };
      } catch (error) {
        results[index] = { value: null, error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function getExtractorPlaylist(playlistUrl, source, limit) {
  const info = await runYtDlpJson([
    '--no-warnings',
    '--flat-playlist',
    '--playlist-end',
    String(limit),
    '--ignore-errors',
    ...javascriptRuntimeArgs(),
    '--skip-download',
    '--dump-single-json',
    '--socket-timeout',
    '10',
    '--',
    playlistUrl,
  ], source);
  if (!Array.isArray(info.entries)) {
    throw new Error(`Link không phải playlist ${source} công khai hoặc playlist không có bài.`);
  }
  return {
    title: String(info.title || 'Playlist').slice(0, 250),
    entries: info.entries.slice(0, limit),
  };
}

function getExtractorEntryUrl(entry, source) {
  if (source === 'YouTube' && typeof entry.id === 'string' && VIDEO_ID_PATTERN.test(entry.id)) {
    return `https://www.youtube.com/watch?v=${entry.id}`;
  }
  const candidateUrl = entry.webpage_url || entry.url;
  if (typeof candidateUrl !== 'string') {
    throw new Error('Playlist có bài thiếu liên kết track.');
  }
  return normalizeAudioUrl(candidateUrl);
}

function isPlaylistRequest(url, source) {
  const parsedUrl = new URL(url);
  return source === 'Spotify'
    ? parsedUrl.pathname.includes('/playlist/')
    : source === 'SoundCloud'
      ? parsedUrl.pathname.split('/').includes('sets')
      : parsedUrl.pathname === '/playlist';
}

export async function resolveAudioInput(input, { limit = config.MAX_QUEUE_SIZE } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Queue đã đầy, không còn chỗ để thêm bài.');
  }
  const requestedUrl = normalizeAudioUrl(input);
  const { source: requestedSource } = parseAudioUrl(requestedUrl);
  const isPlaylist = isPlaylistRequest(requestedUrl, requestedSource);

  if (!isPlaylist) {
    return {
      isPlaylist: false,
      playlistTitle: null,
      skippedCount: 0,
      tracks: [await resolveSingleTrack(requestedUrl, requestedSource,
        requestedSource === 'Spotify' ? await getSpotifyTrackTitle(requestedUrl) : null)],
    };
  }

  let playlistTitle;
  let entries;
  if (requestedSource === 'Spotify') {
    entries = await getSpotifyPlaylistTracks(requestedUrl, limit);
    playlistTitle = 'Spotify playlist';
  } else {
    const playlist = await getExtractorPlaylist(requestedUrl, requestedSource, limit);
    playlistTitle = playlist.title;
    entries = playlist.entries;
  }
  if (!entries.length) {
    throw new Error('Playlist không có bài công khai có thể phát.');
  }

  const resolved = await mapWithConcurrency(entries, PLAYLIST_RESOLUTION_CONCURRENCY, async (entry) => {
    if (requestedSource === 'Spotify') {
      const title = entry.name.trim().slice(0, 300);
      const artists = entry.artists.map((artist) => artist.name).filter(Boolean).join(' ').slice(0, 300);
      if (!title) throw new Error('Track Spotify không có tên hợp lệ.');
      const match = await searchYoutubeTrack(title, artists);
      const track = await resolveSingleTrack(match.url, 'YouTube', match.matchedFrom);
      return {
        ...track,
        requestedSource: 'Spotify',
        requestedUrl,
      };
    }
    const trackUrl = getExtractorEntryUrl(entry, requestedSource);
    return resolveSingleTrack(trackUrl, requestedSource);
  });
  const tracks = resolved.filter((result) => result.value).map((result) => result.value);
  const failedResults = resolved.filter((result) => result.error);
  const skippedCount = failedResults.length;
  if (!tracks.length) {
    const firstError = failedResults[0]?.error;
    throw new Error(`Không tìm được bài nào có thể phát trong playlist. ${firstError?.message || ''}`.trim());
  }

  return {
    isPlaylist: true,
    playlistTitle,
    skippedCount,
    skippedReasons: failedResults.slice(0, 3).map((result) => result.error.message),
    tracks,
  };
}

export async function getAudioTrackInfo(input) {
  const requestedUrl = normalizeAudioUrl(input);
  const { source } = parseAudioUrl(requestedUrl);
  if (isPlaylistRequest(requestedUrl, source)) {
    throw new Error('Hãy dùng resolveAudioInput để thêm playlist vào queue.');
  }
  return (await resolveAudioInput(requestedUrl, { limit: 1 })).tracks[0];
}

export function spawnAudioStream(url) {
  const safeUrl = normalizeAudioUrl(url);
  const parsed = new URL(safeUrl);
  const { source } = parseAudioUrl(safeUrl);
  if (isPlaylistRequest(safeUrl, source)) {
    throw new Error('Không thể phát link playlist trực tiếp; cần thêm từng track vào queue.');
  }
  const child = spawn(config.YT_DLP_PATH, [
    '--no-warnings',
    '--no-playlist',
    '--no-progress',
    ...javascriptRuntimeArgs(),
    '--format',
    'bestaudio',
    '--socket-timeout',
    '10',
    '--retries',
    '2',
    '-o',
    '-',
    '--',
    safeUrl,
  ], {
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  trackProcess(child);
  return child;
}

export function terminateAudioSourceProcesses() {
  for (const child of activeProcesses) {
    if (!child.killed) child.kill();
  }
}
