import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const workDir = path.join(rootDir, 'work');
const outputDir = path.join(rootDir, 'output');
const profileImage = path.join(rootDir, 'assets', 'profile.png');
const verifiedImage = path.join(rootDir, 'assets', 'verified.png');

const FONT_REGULAR = process.env.FONT_REGULAR || defaultFont('regular');
const FONT_BOLD = process.env.FONT_BOLD || defaultFont('bold');
const EMOJI_FONT = process.env.EMOJI_FONT || path.join(rootDir, 'assets', 'fonts', 'AppleColorEmoji.ttf');

const CANVAS = { w: 1080, h: 1920 };
const SAFE = { x: 0, y: 285, w: 1080, h: 1350 };
const CARD = { x: 100, y: 305, w: 880, h: 1310 };

export async function renderPayload(payload) {
  validatePayload(payload);

  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const postId = safeName(payload.postId || `post-${Date.now()}`);
  const sourceVideo = await downloadToFile(payload.videoUrl, path.join(workDir, `${postId}-source.mp4`));
  const duration = await probeDuration(sourceVideo);
  const renderDuration = Math.max(2, Math.min(Number(payload.durationSeconds || duration || 12), 20));

  const files = [];
  for (const variant of payload.variants) {
    const index = Number(variant.index || files.length + 1);
    const fileName = `${postId}_${index}.mp4`;
    const outPath = path.join(outputDir, fileName);
    const textPath = path.join(workDir, `${postId}_${index}.txt`);
    const textLayout = fitCopyText(String(variant.text || ''));

    await fs.writeFile(textPath, textLayout.text, 'utf8');
    await renderVariant({
      input: sourceVideo,
      output: outPath,
      textPath,
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

async function renderVariant({ input, output, textPath, textLayout, duration }) {
  const headerY = CARD.y + 78;
  const avatarSize = 96;
  const profileTextX = CARD.x + 116;
  const profileNameSize = 38;
  const profileHandleSize = 29;
  const profileGap = 2;
  const profileBlockHeight = profileNameSize + profileGap + profileHandleSize;
  const profileNameY = Math.round(headerY + (avatarSize - profileBlockHeight) / 2);
  const profileHandleY = profileNameY + profileNameSize + profileGap;
  const verifiedSize = 23;
  const copyY = CARD.y + 190;
  const videoY = copyY + textLayout.height + 52;
  const videoBottomLimit = SAFE.y + SAFE.h - 40;
  const video = {
    x: CARD.x,
    y: videoY,
    w: CARD.w,
    h: clamp(videoBottomLimit - videoY, 460, 780),
    radius: 64
  };

  const filter = [
    `[0:v]scale=${video.w}:${video.h}:force_original_aspect_ratio=increase,crop=${video.w}:${video.h},setsar=1,format=rgba[vid]`,
    `[1:v]scale=150:150:force_original_aspect_ratio=increase,crop=150:150,scale=${avatarSize}:${avatarSize},format=rgba[avatar]`,
    roundedAlpha('avatar', 'avatarRound', avatarSize, avatarSize, Math.round(avatarSize / 2)),
    `[2:v]scale=${verifiedSize}:${verifiedSize}:force_original_aspect_ratio=decrease,format=rgba[verifiedIcon]`,
    roundedAlpha('vid', 'rounded', video.w, video.h, video.radius),
    `color=c=white:s=${CANVAS.w}x${CANVAS.h}:d=${duration}[bg]`,
    `[bg]drawbox=x=${CARD.x}:y=${CARD.y}:w=${CARD.w}:h=${CARD.h}:color=white:t=fill[card]`,
    `[card][avatarRound]overlay=x=${CARD.x}:y=${headerY}[withAvatar]`,
    drawCircleStroke('withAvatar', 'avatarBordered', CARD.x, headerY, avatarSize, duration),
    drawText({
      input: 'avatarBordered',
      output: 'brandtop',
      text: 'Tlin',
      font: FONT_BOLD,
      size: profileNameSize,
      color: 'black',
      x: profileTextX,
      y: profileNameY
    }),
    `[brandtop][verifiedIcon]overlay=x=${profileTextX + 75}:y=${profileNameY + Math.round((profileNameSize - verifiedSize) / 2) + 1}[brandVerified]`,
    drawText({
      input: 'brandVerified',
      output: 'handle',
      text: '@tlin.ai',
      font: FONT_REGULAR,
      size: profileHandleSize,
      color: '0x536471',
      x: profileTextX,
      y: profileHandleY
    }),
    drawTextFile({
      input: 'handle',
      output: 'copy',
      textPath,
      font: FONT_BOLD,
      size: textLayout.fontSize,
      color: 'black',
      x: CARD.x,
      y: copyY,
      lineSpacing: textLayout.lineSpacing
    }),
    `[copy][rounded]overlay=x=${video.x}:y=${video.y}[withvideo]`,
    drawRoundedStroke('withvideo', 'videoedge', video.x, video.y, video.w, video.h, video.radius, '0x111111@0.10', 6),
    `[videoedge]copy[footer]`,
    `[footer]format=yuv420p[outv]`
  ].join(';');

  await run('ffmpeg', [
    '-y',
    '-stream_loop', '-1',
    '-i', input,
    '-i', profileImage,
    '-i', verifiedImage,
    '-t', String(duration),
    '-filter_complex', filter,
    '-map', '[outv]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    output
  ]);
}

function drawText({ input, output, text, font, size, color, x, y }) {
  return `[${input}]drawtext=fontfile='${ffPath(font)}':text='${ffText(text)}':fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}[${output}]`;
}

function drawTextFile({ input, output, textPath, font, size, color, x, y, lineSpacing }) {
  return `[${input}]drawtext=fontfile='${ffPath(font)}':textfile='${ffPath(textPath)}':fontcolor=${color}:fontsize=${size}:line_spacing=${lineSpacing}:x=${x}:y=${y}[${output}]`;
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
