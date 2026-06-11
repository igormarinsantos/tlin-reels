import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const configDir = path.join(rootDir, 'config');
const assetDir = path.join(configDir, 'assets');
const settingsPath = path.join(configDir, 'settings.json');

const defaults = {
  profileName: 'Tlin',
  profileHandle: '@tlin.ai',
  profileImageUrl: '',
  verifiedImageUrl: '',
  verifiedGap: 5,
  fontFamily: 'dm-sans'
};

export async function loadSettings() {
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...defaults };
  }
}

export async function saveSettings(input) {
  await fs.mkdir(assetDir, { recursive: true });
  const current = await loadSettings();
  const next = normalizeSettings({ ...current, ...input });

  if (input.profileImageData) {
    next.profileImageUrl = await saveDataImage(input.profileImageData, 'profile');
  }

  if (input.verifiedImageData) {
    next.verifiedImageUrl = await saveDataImage(input.verifiedImageData, 'verified');
  }

  await fs.writeFile(settingsPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function normalizeSettings(input) {
  return {
    profileName: String(input.profileName || defaults.profileName),
    profileHandle: String(input.profileHandle || defaults.profileHandle),
    profileImageUrl: String(input.profileImageUrl || ''),
    verifiedImageUrl: String(input.verifiedImageUrl || ''),
    verifiedGap: clamp(Number(input.verifiedGap ?? defaults.verifiedGap), 0, 28),
    fontFamily: normalizeFontFamily(input.fontFamily)
  };
}

function normalizeFontFamily(value) {
  const normalized = String(value || defaults.fontFamily).trim().toLowerCase();
  return normalized === 'inter' ? 'inter' : 'dm-sans';
}

async function saveDataImage(dataUrl, baseName) {
  const match = String(dataUrl).match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) {
    throw new Error(`Imagem ${baseName} invalida.`);
  }

  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const relativePath = `config/assets/${baseName}.${ext}`;
  await fs.writeFile(path.join(rootDir, relativePath), Buffer.from(match[2], 'base64'));
  return relativePath;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return defaults.verifiedGap;
  return Math.max(min, Math.min(max, value));
}
