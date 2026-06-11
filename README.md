# Tlin Reels Renderer

Servico local para receber dados do n8n e gerar videos MP4 verticais para Instagram.

## Rodar

```bash
npm install
npm start
```

## Configuracao

Variaveis uteis no Coolify:

```text
PUBLIC_URL=https://reels.tlin.cloud
MAX_DURATION_SECONDS=12
FFMPEG_PRESET=ultrafast
FFMPEG_CRF=22
COPY_VIDEO_GAP=38
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
PROFILE_NAME=Tlin
PROFILE_HANDLE=@tlin.ai
PROFILE_IMAGE_URL=https://seu-dominio.com/profile.png
VERIFIED_IMAGE_URL=https://seu-dominio.com/verified.png
FONT_FAMILY=dm-sans
```

`FFMPEG_PRESET=ultrafast` acelera bastante e aumenta um pouco o tamanho do arquivo. Se quiser mais qualidade/arquivo menor, use `veryfast`.

## Emoji

O projeto inclui `assets/fonts/AppleColorEmoji.ttf`, baixada da release Linux de `samuelngs/apple-emoji-ttf`. A camada estatica do layout e renderizada por Chromium headless como PNG, entao copy, acentos e emojis sao desenhados antes do FFmpeg compor o video.

```text
EMOJI_FONT=/app/assets/fonts/AppleColorEmoji.ttf
USE_FONTCONFIG=0
```

Observacao: a fonte da Apple e proprietaria; confira a licenca/uso antes de distribuir publicamente.

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
  "maxDurationSeconds": 12,
  "profile": {
    "name": "Tlin",
    "handle": "@tlin.ai",
    "imageUrl": "https://example.com/profile.png",
    "verifiedImageUrl": "https://example.com/verified.png",
    "fontFamily": "dm-sans"
  },
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
  "maxDurationSeconds": 12,
  "profile": {
    "name": "Tlin",
    "handle": "@tlin.ai",
    "imageUrl": "https://SEU_LINK/profile.png",
    "verifiedImageUrl": "https://SEU_LINK/verified.png",
    "fontFamily": "dm-sans"
  },
  "variants": [
    { "index": 1, "text": "={{ $json.texto1 }}" },
    { "index": 2, "text": "={{ $json.texto2 }}" },
    { "index": 3, "text": "={{ $json.texto3 }}" }
  ]
}
```

Para trocar para Inter, use `"fontFamily": "inter"` no `profile`, mande `"fontFamily": "inter"` na raiz do payload, ou escolha na interface `https://reels.tlin.cloud/`.
