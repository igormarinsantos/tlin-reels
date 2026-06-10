import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

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
const CARD = { x: 100, y: 305, w: 880, h: 1310 };
const COPY_VIDEO_GAP = Number(process.env.COPY_VIDEO_GAP || 28);
const MAX_DURATION_SECONDS = Number(process.env.MAX_DURATION_SECONDS || 20);
const FFMPEG_PRESET = process.env.FFMPEG_PRESET || 'veryfast';
const FFMPEG_CRF = String(process.env.FFMPEG_CRF || 20);
const HEADER = {
  y: CARD.y + 78,
  avatarSize: 96,
  profileTextX: CARD.x + 116,
  nameSize: 38,
  handleSize: 29,
  gap: 2,
  verifiedSize: 23
};

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
  const textPath = path.join(workDir, `${postId}_${index}.txt`);
  const avatarBuffer = await createRoundAvatar(profile.image, HEADER.avatarSize);
  await Promise.all([
    fs.writeFile(avatarLayer, avatarBuffer),
    fs.writeFile(textPath, textLayout.text, 'utf8')
  ]);

  const profileBlockHeight = HEADER.nameSize + HEADER.gap + HEADER.handleSize;
  const profileNameY = Math.round(HEADER.y + (HEADER.avatarSize - profileBlockHeight) / 2);
  const profileHandleY = profileNameY + HEADER.nameSize + HEADER.gap;
  const verifiedX = HEADER.profileTextX + estimateTextWidth(profile.name, HEADER.nameSize, 0.55) + 9;
  const verifiedY = profileNameY + Math.round((HEADER.nameSize - HEADER.verifiedSize) / 2) + 1;

  const frameSvg = `
<svg width="${CANVAS.w}" height="${CANVAS.h}" viewBox="0 0 ${CANVAS.w} ${CANVAS.h}" xmlns="http://www.w3.org/2000/svg">
  <path d="${cornerMaskPath(video.x, video.y, video.w, video.h, video.radius)}" fill="white" fill-rule="evenodd"/>
  <rect x="${video.x + 3}" y="${video.y + 3}" width="${video.w - 6}" height="${video.h - 6}" rx="${video.radius - 3}" ry="${video.radius - 3}" fill="none" stroke="rgba(17,17,17,0.10)" stroke-width="6"/>
</svg>`;

  const baseFilter = [
    `[0:v][1:v]overlay=x=${CARD.x}:y=${HEADER.y}[withAvatar]`,
    drawCircleStroke('withAvatar', 'avatarBordered', CARD.x, HEADER.y, HEADER.avatarSize, 1),
    drawText({
      input: 'avatarBordered',
      output: 'brandtop',
      text: profile.name,
      font: FONT_BOLD,
      size: HEADER.nameSize,
      color: 'black',
      x: HEADER.profileTextX,
      y: profileNameY
    }),
    profile.showVerified
      ? `[2:v]scale=${HEADER.verifiedSize}:${HEADER.verifiedSize}:force_original_aspect_ratio=decrease,format=rgba[verifiedIcon];[brandtop][verifiedIcon]overlay=x=${verifiedX}:y=${verifiedY}[brandVerified]`
      : `[brandtop]copy[brandVerified]`,
    drawText({
      input: 'brandVerified',
      output: 'handle',
      text: profile.handle,
      font: FONT_REGULAR,
      size: HEADER.handleSize,
      color: '0x536471',
      x: HEADER.profileTextX,
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
    `[copy]format=rgba[baseout]`
  ].join(';');

  const baseArgs = [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=white:s=${CANVAS.w}x${CANVAS.h}:d=1`,
    '-i', avatarLayer
  ];

  if (profile.showVerified) {
    baseArgs.push('-i', profile.verifiedImage);
  } else {
    baseArgs.push('-f', 'lavfi', '-i', 'color=c=white@0:s=1x1:d=1');
  }

  baseArgs.push(
    '-filter_complex', baseFilter,
    '-map', '[baseout]',
    '-frames:v', '1',
    baseLayer
  );

  await Promise.all([
    run('ffmpeg', baseArgs),
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

function estimateTextWidth(text, fontSize, factor) {
  return Math.round(String(text).length * fontSize * factor);
}


function drawText({ input, output, text, font, size, color, x, y }) {
  return `[${input}]drawtext=${fontOption(font)}:text='${ffText(text)}':fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}[${output}]`;
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
