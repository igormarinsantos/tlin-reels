import express from 'express';
import { renderPayload } from './renderer.js';
import { loadSettings, saveSettings } from './settings.js';

const app = express();
const port = Number(process.env.PORT || 8787);

app.set('trust proxy', true);
app.use(express.json({ limit: '20mb', type: ['application/json', 'application/*+json', 'text/plain', '*/*'] }));
app.use('/output', express.static('output'));
app.use('/assets', express.static('assets'));
app.use('/config-assets', express.static('config/assets'));

app.get('/', (req, res) => {
  res.type('html').send(settingsPage());
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/settings', async (req, res) => {
  res.json(await loadSettings());
});

app.post('/settings', async (req, res) => {
  try {
    res.json(await saveSettings(req.body || {}));
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || String(error)
    });
  }
});

app.post('/render', async (req, res) => {
  try {
    const result = await renderPayload(req.body);
    const origin = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    res.json({
      ...result,
      files: result.files.map(file => ({
        ...file,
        publicUrl: new URL(file.url, origin).toString()
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: error.message || String(error)
    });
  }
});

const server = app.listen(port, () => {
  console.log(`Tlin Reels Renderer listening on http://localhost:${port}`);
});

server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 15 * 60 * 1000);
server.headersTimeout = server.requestTimeout + 10 * 1000;
server.keepAliveTimeout = 65 * 1000;

function settingsPage() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tlin Reels</title>
<style>
@font-face{font-family:DMSans;src:url('/assets/fonts/DMSans-Regular.ttf');font-weight:400}
@font-face{font-family:DMSans;src:url('/assets/fonts/DMSans-Bold.ttf');font-weight:700}
@font-face{font-family:InterPreview;src:url('/assets/fonts/Inter.ttf');font-weight:100 900}
*{box-sizing:border-box}
body{margin:0;background:#f6f7f9;color:#111;font-family:DMSans,Arial,sans-serif}
main{width:min(920px,calc(100vw - 32px));margin:40px auto}
h1{margin:0 0 24px;font-size:32px;line-height:1.1}
.panel{background:#fff;border:1px solid #dde1e7;border-radius:8px;padding:24px;box-shadow:0 10px 30px rgba(20,25,35,.06)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
label{display:block;font-size:13px;font-weight:700;margin:0 0 7px;color:#344054}
input,select{width:100%;height:44px;border:1px solid #cfd6df;border-radius:6px;padding:0 12px;font:inherit;background:#fff}
input[type=file]{height:auto;padding:10px;background:#fbfcfd}
.full{grid-column:1/-1}
.actions{display:flex;align-items:center;gap:12px;margin-top:22px}
button{height:44px;border:0;border-radius:6px;background:#111;color:#fff;padding:0 18px;font:700 15px DMSans,Arial;cursor:pointer}
button.secondary{background:#eef1f5;color:#111}
.preview{display:flex;align-items:center;gap:20px;margin-top:24px;padding-top:22px;border-top:1px solid #edf0f3}
.preview[data-font="inter"]{font-family:InterPreview,Arial,sans-serif}
.preview[data-font="dm-sans"]{font-family:DMSans,Arial,sans-serif}
.avatar{width:76px;height:76px;border:1px solid #d0d7de;border-radius:50%;object-fit:cover}
.nameRow{display:flex;align-items:center;gap:var(--verified-gap,5px)}
.name{font-weight:700;font-size:30px;line-height:32px}
.verified{width:22px;height:22px;object-fit:contain}
.handle{font-size:24px;color:#536471}
.status{font-size:14px;color:#536471}
@media (max-width:720px){.grid{grid-template-columns:1fr}main{margin:24px auto}.panel{padding:18px}}
</style>
</head>
<body>
<main>
  <h1>Configurar perfil</h1>
  <section class="panel">
    <div class="grid">
      <div>
        <label for="profileName">Nome</label>
        <input id="profileName" placeholder="Tlin">
      </div>
      <div>
        <label for="profileHandle">Usuario</label>
        <input id="profileHandle" placeholder="@tlin.ai">
      </div>
      <div>
        <label for="verifiedGap">Distancia do verified</label>
        <input id="verifiedGap" type="number" min="0" max="28" step="1">
      </div>
      <div>
        <label for="fontFamily">Fonte</label>
        <select id="fontFamily">
          <option value="dm-sans">DM Sans</option>
          <option value="inter">Inter</option>
        </select>
      </div>
      <div>
        <label for="profileFile">Foto de perfil</label>
        <input id="profileFile" type="file" accept="image/*">
      </div>
      <div class="full">
        <label for="profileImageUrl">URL da foto de perfil</label>
        <input id="profileImageUrl" placeholder="https://.../profile.png">
      </div>
      <div>
        <label for="verifiedFile">Verified</label>
        <input id="verifiedFile" type="file" accept="image/*">
      </div>
      <div>
        <label for="verifiedImageUrl">URL do verified</label>
        <input id="verifiedImageUrl" placeholder="https://.../verified.png">
      </div>
    </div>
    <div class="actions">
      <button id="save">Salvar</button>
      <button id="reload" class="secondary">Recarregar</button>
      <span id="status" class="status"></span>
    </div>
    <div id="preview" class="preview" data-font="dm-sans">
      <img id="avatarPreview" class="avatar" src="/assets/profile.png" alt="">
      <div>
        <div id="previewRow" class="nameRow">
          <div id="namePreview" class="name">Tlin</div>
          <img id="verifiedPreview" class="verified" src="/assets/verified.png" alt="">
        </div>
        <div id="handlePreview" class="handle">@tlin.ai</div>
      </div>
    </div>
  </section>
</main>
<script>
const fields = ['profileName','profileHandle','profileImageUrl','verifiedImageUrl','verifiedGap','fontFamily'];
const $ = id => document.getElementById(id);

async function load() {
  const settings = await fetch('/settings').then(r => r.json());
  for (const field of fields) $(field).value = settings[field] || '';
  updatePreview(settings);
}

async function save() {
  $('status').textContent = 'Salvando...';
  const payload = Object.fromEntries(fields.map(field => [field, $(field).value]));
  const profileFile = $('profileFile').files[0];
  const verifiedFile = $('verifiedFile').files[0];
  if (profileFile) payload.profileImageData = await toDataUrl(profileFile);
  if (verifiedFile) payload.verifiedImageData = await toDataUrl(verifiedFile);
  const settings = await fetch('/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json());
  if (settings.error) throw new Error(settings.error);
  $('profileFile').value = '';
  $('verifiedFile').value = '';
  updatePreview(settings);
  $('status').textContent = 'Salvo.';
}

function updatePreview(settings = {}) {
  $('namePreview').textContent = $('profileName').value || settings.profileName || 'Tlin';
  $('handlePreview').textContent = $('profileHandle').value || settings.profileHandle || '@tlin.ai';
  $('previewRow').style.setProperty('--verified-gap', (Number($('verifiedGap').value || settings.verifiedGap || 5)) + 'px');
  $('preview').dataset.font = $('fontFamily').value || settings.fontFamily || 'dm-sans';
  const avatar = $('profileImageUrl').value || settings.profileImageUrl;
  const verified = $('verifiedImageUrl').value || settings.verifiedImageUrl;
  $('avatarPreview').src = publicAssetUrl(avatar) || '/assets/profile.png';
  $('verifiedPreview').src = publicAssetUrl(verified) || '/assets/verified.png';
}

function publicAssetUrl(value) {
  if (!value) return '';
  if (/^https?:\\/\\//.test(value)) return value;
  if (value.startsWith('config/assets/')) return '/' + value.replace('config/assets/', 'config-assets/');
  return '/' + value.replace(/^\\/+/, '');
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

for (const field of fields) $(field).addEventListener('input', () => updatePreview());
$('save').addEventListener('click', () => save().catch(error => $('status').textContent = error.message));
$('reload').addEventListener('click', load);
load();
</script>
</body>
</html>`;
}
