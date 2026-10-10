FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    YT_DLP_PATH=/opt/yt-dlp-venv/bin/yt-dlp \
    DENO_PATH=/usr/local/bin/deno \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    PATH=/opt/yt-dlp-venv/bin:/usr/local/bin:${PATH}

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 python3-venv unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/python -m pip install --no-cache-dir --upgrade 'yt-dlp[default]' \
    && /opt/yt-dlp-venv/bin/yt-dlp --version \
    && /opt/yt-dlp-venv/bin/yt-dlp --help | grep -q -- '--js-runtimes' \
    && /usr/local/bin/deno --version \
    && /usr/bin/ffmpeg -version \
    && apt-get purge -y --auto-remove curl unzip \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "src/index.js"]
