# Tlin Reels Renderer

Servico local para receber dados do n8n e gerar videos MP4 verticais para Instagram.

## Rodar

```bash
npm install
npm start
```

## Emoji Apple

Para renderizar emojis no estilo Apple, coloque a fonte `AppleColorEmoji.ttf` em:

```text
assets/fonts/AppleColorEmoji.ttf
```

No Coolify, mantenha esse arquivo no repositorio ou monte ele como volume e configure:

```text
EMOJI_FONT=/app/assets/fonts/AppleColorEmoji.ttf
```

Observacao: a fonte da Apple e proprietaria, entao ela nao vem embutida neste projeto.

API:

```text
POST http://localhost:8787/render
```

Payload esperado:

```json
{
  "postId": "123",
  "videoUrl": "https://example.com/video.mp4",
  "thumbnailUrl": "https://example.com/thumb.jpg",
  "variants": [
    { "index": 1, "text": "Copy curta..." },
    { "index": 2, "text": "Copy media..." },
    { "index": 3, "text": "Copy longa..." }
  ]
}
```

Resposta:

```json
{
  "ok": true,
  "postId": "123",
  "files": [
    {
      "index": 1,
      "fileName": "123_1.mp4",
      "path": "C:\\...\\output\\123_1.mp4"
    }
  ]
}
```

## n8n

Depois do node que monta `postId`, `texto1`, `texto2`, `texto3`, `video` e `thumb`, envie um HTTP Request:

- Method: `POST`
- URL: `http://SEU_SERVIDOR:8787/render`
- Body JSON:

```json
{
  "postId": "={{ $json.postId }}",
  "videoUrl": "={{ $json.video }}",
  "thumbnailUrl": "={{ $json.thumb }}",
  "variants": [
    { "index": 1, "text": "={{ $json.texto1 }}" },
    { "index": 2, "text": "={{ $json.texto2 }}" },
    { "index": 3, "text": "={{ $json.texto3 }}" }
  ]
}
```
