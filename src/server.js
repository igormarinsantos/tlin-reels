import express from 'express';
import { renderPayload } from './renderer.js';

const app = express();
const port = Number(process.env.PORT || 8787);

app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use('/output', express.static('output'));

app.get('/health', (req, res) => {
  res.json({ ok: true });
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
