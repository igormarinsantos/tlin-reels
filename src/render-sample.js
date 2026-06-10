import fs from 'node:fs/promises';
import path from 'node:path';
import { closeRenderer, renderPayload } from './renderer.js';

const payloadPath = path.resolve('samples/payload.json');
const payload = JSON.parse(await fs.readFile(payloadPath, 'utf8'));
const result = await renderPayload(payload);
await closeRenderer();

console.log(JSON.stringify(result, null, 2));
