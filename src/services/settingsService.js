import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../utils/constants.js';

const dataDirectory = path.resolve(process.cwd(), 'data');
const settingsFile = path.join(dataDirectory, 'guild-settings.json');

export function ensureDataFiles() {
  fs.mkdirSync(dataDirectory, { recursive: true });

  if (!fs.existsSync(settingsFile)) {
    writeJsonFile(settingsFile, {});
  }
}

export function writeJsonFile(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readAllGuildSettings() {
  ensureDataFiles();

  try {
    const raw = fs.readFileSync(settingsFile, 'utf8').trim();
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    throw new Error('Tệp cấu hình server bị lỗi JSON. Vui lòng kiểm tra lại data/guild-settings.json.');
  }
}

export function loadGuildSettings(guildId) {
  if (!guildId) {
    return { ...DEFAULT_SETTINGS };
  }

  const allSettings = readAllGuildSettings();
  const guildSettings = allSettings[guildId] || {};
  const normalized = {
    ...DEFAULT_SETTINGS,
    ...guildSettings,
    allowedUsers: Array.from(new Set((guildSettings.allowedUsers || []).filter(Boolean))),
    allowedRoles: Array.from(new Set((guildSettings.allowedRoles || []).filter(Boolean))),
    allowedMentionRoles: Array.from(new Set((guildSettings.allowedMentionRoles || []).filter(Boolean))),
    allowedAnnouncementChannels: Array.from(new Set((guildSettings.allowedAnnouncementChannels || []).filter(Boolean))),
    logChannelId: typeof guildSettings.logChannelId === 'string' ? guildSettings.logChannelId : null,
  };

  allSettings[guildId] = normalized;
  writeJsonFile(settingsFile, allSettings);

  return normalized;
}

export function saveGuildSettings(guildId, nextSettings) {
  if (!guildId) {
    throw new Error('guildId không hợp lệ.');
  }

  const allSettings = readAllGuildSettings();
  const sanitized = {
    ...DEFAULT_SETTINGS,
    ...nextSettings,
    allowedUsers: Array.from(new Set((nextSettings.allowedUsers || []).filter(Boolean))),
    allowedRoles: Array.from(new Set((nextSettings.allowedRoles || []).filter(Boolean))),
    allowedMentionRoles: Array.from(new Set((nextSettings.allowedMentionRoles || []).filter(Boolean))),
    allowedAnnouncementChannels: Array.from(new Set((nextSettings.allowedAnnouncementChannels || []).filter(Boolean))),
    logChannelId: typeof nextSettings.logChannelId === 'string' ? nextSettings.logChannelId : null,
  };

  allSettings[guildId] = sanitized;
  writeJsonFile(settingsFile, allSettings);
  return sanitized;
}

export function toggleSettingValue(guildId, key, value) {
  const settings = loadGuildSettings(guildId);
  const target = Array.isArray(settings[key]) ? [...settings[key]] : [];
  const index = target.indexOf(value);

  if (index !== -1) {
    target.splice(index, 1);
  } else {
    target.push(value);
  }

  settings[key] = Array.from(new Set(target.filter(Boolean)));
  return saveGuildSettings(guildId, settings);
}
