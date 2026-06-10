import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const workDir = path.join(rootDir, 'work');
const outputDir = path.join(rootDir, 'output');
const profileImage = path.join(rootDir, 'assets', 'profile.png');
const verifiedImage = path.join(rootDir, 'assets', 'verified.png');

const FONT_REGULAR = process.env.FONT_REGULAR || defaultFont('regular');
const FONT_BOLD = process.env.FONT_BOLD || defaultFont('bold');
const EMOJI_FONT = process.env.EMOJI_FONT || path.join(rootDir, 'assets', 'fonts', 'AppleColorEmoji.ttf');
const USE_FONTCONFIG = process.env.USE_FONTCONFIG === '1';

const CANVAS = { w: 1080, h: 1920 };
const SAFE = { x: 0, y: 285, w: 1080, h: 1350 };
const CARD = { x: 50, y: 305, w: 980, h: 1310 };
const COPY_VIDEO_GAP = Number(process.env.COPY_VIDEO_GAP || 38);
const MAX_DURATION_SECONDS = Number(process.env.MAX_DURATION_SECONDS || 20);
const FFMPEG_PRESET = process.env.FFMPEG_PRESET || 'veryfast';
const FFMPEG_CRF = String(process.env.FFMPEG_CRF || 20);
const CHROMIUM_EXECUTABLE_PATH = process.env.CHROMIUM_EXECUTABLE_PATH || '';
const HEADER = {
  y: CARD.y + 78,
  avatarSize: 96,
  profileTextX: CARD.x + 116,
  nameSize: 38,
  handleSize: 29,
  gap: 2,
  verifiedSize: 23
};

let browserPromise;

export async function renderPayload(payload) {
  validatePayload(payload);

  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const postId = safeName(payload.postId || `post-${Date.now()}`);
  const sourceVideo = await downloadToFile(payload.videoUrl, path.join(workDir, `${postId}-source.mp4`));
  const duration = await probeDuration(sourceVideo);
  const maxDuration = Number(payload.maxDurationSeconds || MAX_DURATION_SECONDS || 20);
  const renderDuration = Math.max(2, Math.min(Number(payload.durationSeconds || duration || 12), maxDuration));
  const profile = await resolveProfile(payload, postId);

  const files = [];
  for (const variant of payload.variants) {
    const index = Number(variant.index || files.length + 1);
    const fileName = `${postId}_${index}.mp4`;
    const outPath = path.join(outputDir, fileName);
    const textLayout = fitCopyText(String(variant.text || ''));
    const layers = await createStaticLayers({
      postId,
      index,
      textLayout,
      profile
    });

    await renderVariant({
      input: sourceVideo,
      output: outPath,
      baseLayer: layers.baseLayer,
      frameLayer: layers.frameLayer,
      textLayout,
      duration: renderDuration
    });

    files.push({
      index,
      fileName,
      path: outPath,
      url: `/output/${fileName}`
    });
  }

  return {
    ok: true,
    postId,
    files
  };
}

export async function closeRenderer() {
  if (!browserPromise) return;

  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload JSON ausente ou invalido.');
  }

  if (!payload.videoUrl || typeof payload.videoUrl !== 'string') {
    throw new Error('videoUrl e obrigatorio.');
  }

  if (!Array.isArray(payload.variants) || payload.variants.length === 0) {
    throw new Error('variants precisa ter pelo menos uma copy.');
  }
}

async function downloadToFile(url, destination) {
  if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('/')) {
    return url;
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Falha ao baixar video: HTTP ${response.status}`);
  }

  await pipeline(response.body, createWriteStream(destination));
  return destination;
}

async function probeDuration(input) {
  const result = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    input
  ]);

  return Number(result.stdout.trim()) || 0;
}

async function renderVariant({ input, output, baseLayer, frameLayer, textLayout, duration }) {
  const copyY = CARD.y + 190;
  const videoY = copyY + textLayout.height + COPY_VIDEO_GAP;
  const videoBottomLimit = SAFE.y + SAFE.h - 40;
  const video = {
    x: CARD.x,
    y: videoY,
    w: CARD.w,
    h: clamp(videoBottomLimit - videoY, 460, 780),
    radius: 78
  };

  const filter = [
    `[0:v]scale=${video.w}:${video.h}:force_original_aspect_ratio=increase,crop=${video.w}:${video.h},setsar=1[vid]`,
    `[1:v]format=rgba[base]`,
    `[base][vid]overlay=x=${video.x}:y=${video.y}[withvideo]`,
    `[withvideo][2:v]overlay=x=0:y=0,format=yuv420p[outv]`
  ].join(';');

  await run('ffmpeg', [
    '-y',
    '-stream_loop', '-1',
    '-i', input,
    '-loop', '1',
    '-i', baseLayer,
    '-loop', '1',
    '-i', frameLayer,
    '-t', String(duration),
    '-filter_complex', filter,
    '-map', '[outv]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', FFMPEG_PRESET,
    '-crf', FFMPEG_CRF,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    output
  ]);
}

async function resolveProfile(payload, postId) {
  const profile = payload.profile || {};
  const imageSource = profile.imageUrl || payload.profileImageUrl || process.env.PROFILE_IMAGE_URL || process.env.PROFILE_IMAGE || profileImage;
  const verifiedSource = profile.verifiedImageUrl || payload.verifiedImageUrl || process.env.VERIFIED_IMAGE_URL || process.env.VERIFIED_IMAGE || verifiedImage;

  return {
    name: String(profile.name || payload.profileName || process.env.PROFILE_NAME || 'Tlin'),
    handle: String(profile.handle || payload.profileHandle || process.env.PROFILE_HANDLE || '@tlin.ai'),
    image: await resolveAsset(imageSource, path.join(workDir, `${postId}-profile${path.extname(urlishPath(imageSource)) || '.png'}`)),
    verifiedImage: await resolveAsset(verifiedSource, path.join(workDir, `${postId}-verified${path.extname(urlishPath(verifiedSource)) || '.png'}`)),
    showVerified: profile.verified !== false && payload.showVerified !== false
  };
}

async function resolveAsset(source, destination) {
  if (!source) return '';
  if (/^https?:\/\//i.test(source)) {
    return downloadToFile(source, destination);
  }
  if (/^[a-zA-Z]:[\\/]/.test(source) || source.startsWith('/')) {
    return source;
  }
  return path.join(rootDir, source);
}

function urlishPath(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return String(value || '');
  }
}

async function createStaticLayers({ postId, index, textLayout, profile }) {
  const copyY = CARD.y + 190;
  const videoY = copyY + textLayout.height + COPY_VIDEO_GAP;
  const videoBottomLimit = SAFE.y + SAFE.h - 40;
  const video = {
    x: CARD.x,
    y: videoY,
    w: CARD.w,
    h: clamp(videoBottomLimit - videoY, 460, 780),
    radius: 78
  };

  const baseLayer = path.join(workDir, `${postId}_${index}-base.png`);
  const frameLayer = path.join(workDir, `${postId}_${index}-frame.png`);
  const avatarLayer = path.join(workDir, `${postId}_${index}-avatar.png`);
  const avatarBuffer = await createRoundAvatar(profile.image, HEADER.avatarSize);
  await fs.writeFile(avatarLayer, avatarBuffer);

  const frameSvg = `
<svg width="${CANVAS.w}" height="${CANVAS.h}" viewBox="0 0 ${CANVAS.w} ${CANVAS.h}" xmlns="http://www.w3.org/2000/svg">
  <path d="${cornerMaskPath(video.x, video.y, video.w, video.h, video.radius)}" fill="white" fill-rule="evenodd"/>
  <rect x="${video.x + 3}" y="${video.y + 3}" width="${video.w - 6}" height="${video.h - 6}" rx="${video.radius - 3}" ry="${video.radius - 3}" fill="none" stroke="rgba(17,17,17,0.20)" stroke-width="6"/>
</svg>`;

  await Promise.all([
    renderBaseLayerWithBrowser({
      output: baseLayer,
      textLayout,
      profile,
      avatarLayer
    }),
    sharp(Buffer.from(frameSvg)).png().toFile(frameLayer)
  ]);

  return { baseLayer, frameLayer };
}

async function createRoundAvatar(input, size) {
  const avatar = await sharp(input)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer();
  const mask = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`);

  return sharp(avatar)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

function cornerMaskPath(x, y, w, h, r) {
  return [
    `M${x} ${y}h${w}v${h}h-${w}z`,
    `M${x + r} ${y}`,
    `h${w - 2 * r}`,
    `a${r} ${r} 0 0 1 ${r} ${r}`,
    `v${h - 2 * r}`,
    `a${r} ${r} 0 0 1 -${r} ${r}`,
    `h-${w - 2 * r}`,
    `a${r} ${r} 0 0 1 -${r} -${r}`,
    `v-${h - 2 * r}`,
    `a${r} ${r} 0 0 1 ${r} -${r}`,
    'z'
  ].join(' ');
}

function drawText({ input, output, text, font, size, color, x, y }) {
  return `[${input}]drawtext=${fontOption(font)}:text='${ffText(text)}':fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}[${output}]`;
}

async function renderBaseLayerWithBrowser({ output, textLayout, profile, avatarLayer }) {
  const profileBlockHeight = HEADER.nameSize + HEADER.gap + HEADER.handleSize;
  const profileNameY = Math.round(HEADER.y + (HEADER.avatarSize - profileBlockHeight) / 2);
  const profileHandleY = profileNameY + HEADER.nameSize + HEADER.gap;
  const copyY = CARD.y + 190;
  const [regularFont, boldFont, avatar, verified] = await Promise.all([
    fs.readFile(FONT_REGULAR),
    fs.readFile(FONT_BOLD),
    fs.readFile(avatarLayer),
    profile.showVerified ? fs.readFile(profile.verifiedImage) : Promise.resolve(null)
  ]);
  const html = staticLayerHtml({
    profile,
    textLayout,
    profileNameY,
    profileHandleY,
    copyY,
    regularFont,
    boldFont,
    avatar,
    verified
  });
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: CANVAS.w,
      height: CANVAS.h,
      deviceScaleFactor: 1
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({
      path: output,
      type: 'png',
      omitBackground: false
    });
  } finally {
    await page.close();
  }
}

function staticLayerHtml({ profile, textLayout, profileNameY, profileHandleY, copyY, regularFont, boldFont, avatar, verified }) {
  const emojiFace = `@font-face{font-family:AppleEmojiLocal;src:url("${fileUrl(EMOJI_FONT)}") format('truetype');}`;
  const fontStack = 'DMSansLocal, sans-serif';
  const emojiStack = 'AppleEmojiLocal, "Apple Color Emoji", "Noto Color Emoji"';
  const copyLineHeight = textLayout.fontSize + textLayout.lineSpacing;
  const lines = textLayout.text.split('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@font-face{font-family:DMSansLocal;src:url(data:font/truetype;base64,${regularFont.toString('base64')}) format('truetype');font-weight:400;font-style:normal;}
@font-face{font-family:DMSansLocal;src:url(data:font/truetype;base64,${boldFont.toString('base64')}) format('truetype');font-weight:700;font-style:normal;}
${emojiFace}
*{box-sizing:border-box}
html,body{margin:0;width:${CANVAS.w}px;height:${CANVAS.h}px;background:#fff;overflow:hidden}
body{font-family:${fontStack};letter-spacing:0}
.avatar{position:absolute;left:${CARD.x}px;top:${HEADER.y}px;width:${HEADER.avatarSize}px;height:${HEADER.avatarSize}px;border:2px solid #d0d7de;border-radius:999px}
.nameRow{position:absolute;left:${HEADER.profileTextX}px;top:${profileNameY}px;height:${HEADER.nameSize + 3}px;display:flex;align-items:center;gap:5px}
.name{font-family:${fontStack};font-weight:700;font-size:${HEADER.nameSize}px;line-height:${HEADER.nameSize}px;color:#000}
.verified{width:${HEADER.verifiedSize}px;height:${HEADER.verifiedSize}px;display:block;transform:translateY(1px)}
.handle{position:absolute;left:${HEADER.profileTextX}px;top:${profileHandleY}px;font-family:${fontStack};font-weight:400;font-size:${HEADER.handleSize}px;line-height:${HEADER.handleSize}px;color:#536471}
.copy{position:absolute;left:${CARD.x}px;top:${copyY}px;width:${CARD.w}px;font-family:${fontStack};font-weight:700;font-size:${textLayout.fontSize}px;line-height:${copyLineHeight}px;color:#000}
.emoji{font-family:${emojiStack};font-weight:400}
</style>
</head>
<body>
<img class="avatar" src="data:image/png;base64,${avatar.toString('base64')}">
<div class="nameRow"><span class="name">${escapeHtml(profile.name)}</span>${profile.showVerified && verified ? `<img class="verified" src="data:image/png;base64,${verified.toString('base64')}">` : ''}</div>
<div class="handle">${escapeHtml(profile.handle)}</div>
<div class="copy">${lines.map(line => `<div>${renderTextWithEmoji(line)}</div>`).join('')}</div>
</body>
</html>`;
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: resolveChromiumExecutable(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
      headless: 'new'
    });
  }

  return browserPromise;
}

function resolveChromiumExecutable() {
  if (CHROMIUM_EXECUTABLE_PATH) return CHROMIUM_EXECUTABLE_PATH;

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome'
  ];

  return candidates.find(candidate => requireFsExists(candidate)) || candidates[0];
}

function requireFsExists(candidate) {
  return existsSync(candidate);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTextWithEmoji(value) {
  const parts = [];
  let current = '';
  let currentIsEmoji = false;

  for (const char of String(value)) {
    const isEmoji = isEmojiChar(char);
    if (current && isEmoji !== currentIsEmoji) {
      parts.push({ text: current, isEmoji: currentIsEmoji });
      current = '';
    }

    current += char;
    currentIsEmoji = isEmoji;
  }

  if (current) {
    parts.push({ text: current, isEmoji: currentIsEmoji });
  }

  return parts
    .map(part => part.isEmoji
      ? `<span class="emoji">${escapeHtml(part.text)}</span>`
      : escapeHtml(part.text))
    .join('');
}

function isEmojiChar(char) {
  return /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(char);
}

function fileUrl(filePath) {
  return encodeURI(`file:///${path.resolve(filePath).replace(/\\/g, '/')}`);
}

function drawTextFile({ input, output, textPath, font, size, color, x, y, lineSpacing }) {
  return `[${input}]drawtext=${fontOption(font)}:textfile='${ffPath(textPath)}':fontcolor=${color}:fontsize=${size}:line_spacing=${lineSpacing}:x=${x}:y=${y}[${output}]`;
}

function drawRoundedStroke(input, output, x, y, w, h, r, color, thickness) {
  const boxes = [
    `drawbox=x=${x + r}:y=${y}:w=${w - 2 * r}:h=${thickness}:color=${color}:t=fill`,
    `drawbox=x=${x + r}:y=${y + h - thickness}:w=${w - 2 * r}:h=${thickness}:color=${color}:t=fill`,
    `drawbox=x=${x}:y=${y + r}:w=${thickness}:h=${h - 2 * r}:color=${color}:t=fill`,
    `drawbox=x=${x + w - thickness}:y=${y + r}:w=${thickness}:h=${h - 2 * r}:color=${color}:t=fill`
  ].join(',');

  return `[${input}]${boxes}[${output}]`;
}

function drawCircleStroke(input, output, x, y, size, duration) {
  const centerX = x + size / 2;
  const centerY = y + size / 2;
  const outer = size / 2;
  const inner = outer - 2;
  const alpha = `if(between(hypot(X-${centerX}\\,Y-${centerY})\\,${inner}\\,${outer})\\,255\\,0)`;

  return [
    `color=c=0xD0D7DE:s=${CANVAS.w}x${CANVAS.h}:d=${duration},format=rgba[avatarStrokeBase]`,
    `[avatarStrokeBase]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[avatarStroke]`,
    `[${input}][avatarStroke]overlay=0:0[${output}]`
  ].join(';');
}

function roundedAlpha(input, output, width, height, radius) {
  const alpha = [
    `if(lt(X,${radius})*lt(Y,${radius}),if(lte(hypot(${radius}-X\\,${radius}-Y)\\,${radius})\\,255\\,0)`,
    `if(gt(X,W-${radius})*lt(Y,${radius}),if(lte(hypot(X-(W-${radius})\\,${radius}-Y)\\,${radius})\\,255\\,0)`,
    `if(lt(X,${radius})*gt(Y,H-${radius}),if(lte(hypot(${radius}-X\\,Y-(H-${radius}))\\,${radius})\\,255\\,0)`,
    `if(gt(X,W-${radius})*gt(Y,H-${radius}),if(lte(hypot(X-(W-${radius})\\,Y-(H-${radius}))\\,${radius})\\,255\\,0)`,
    '255))))'
  ].join(',');

  return `[${input}]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}',format=rgba[${output}]`;
}

function ffPath(value) {
  return path.resolve(value).replace(/\\/g, '/').replace(':', '\\:');
}

function fontOption(font) {
  if (!USE_FONTCONFIG) {
    return `fontfile='${ffPath(font)}'`;
  }

  const style = path.basename(font).toLowerCase().includes('bold') ? ':style=Bold' : '';
  return `font='DM Sans${style}'`;
}

function ffText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function fitCopyText(text) {
  const area = { w: CARD.w, h: 255 };

  for (let fontSize = 33; fontSize >= 22; fontSize -= 1) {
    const maxChars = Math.max(20, Math.floor(area.w / (fontSize * 0.54)));
    const lines = wrapText(text, maxChars, 6);
    const lineSpacing = Math.max(8, Math.round(fontSize * 0.32));
    const height = lines.length * fontSize + (lines.length - 1) * lineSpacing;

    if (height <= area.h) {
      return {
        text: lines.join('\n'),
        fontSize,
        lineSpacing,
        height
      };
    }
  }

  const lines = wrapText(text, 52, 6);
  return {
    text: lines.join('\n'),
    fontSize: 22,
    lineSpacing: 8,
    height: lines.length * 22 + (lines.length - 1) * 8
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapText(text, maxChars, maxLines) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  const clipped = lines.slice(0, maxLines);
  clipped[maxLines - 1] = `${clipped[maxLines - 1].replace(/[.,;:!?]+$/g, '')}...`;
  return clipped;
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'post';
}

function defaultFont(weight) {
  return path.join(rootDir, 'assets', 'fonts', weight === 'bold' ? 'DMSans-Bold.ttf' : 'DMSans-Regular.ttf');
}

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk;
    });

    child.stderr.on('data', chunk => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} falhou com codigo ${code}\n${stderr}`));
      }
    });
  });
}
