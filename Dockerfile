FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ffmpeg fontconfig fonts-dejavu-core fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/output /app/work
RUN mkdir -p /usr/local/share/fonts/tlin \
  && cp /app/assets/fonts/*.ttf /usr/local/share/fonts/tlin/ \
  && fc-cache -f

ENV NODE_ENV=production
ENV PORT=8787
ENV EMOJI_FONT=/app/assets/fonts/AppleColorEmoji.ttf
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV USE_FONTCONFIG=0

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
