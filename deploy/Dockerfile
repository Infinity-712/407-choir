ARG BASE_IMAGE=openclaw:local
FROM ${BASE_IMAGE}
USER root
RUN sed -i 's|http://deb.debian.org/debian-security|http://mirrors.cloud.tencent.com/debian-security|g; s|http://deb.debian.org/debian|http://mirrors.cloud.tencent.com/debian|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get -o Acquire::ForceIPv4=true update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nginx-light coturn python3-venv openssl ca-certificates \
 && python3 -m venv /opt/acme \
 && /opt/acme/bin/pip install --no-cache-dir --index-url https://mirrors.cloud.tencent.com/pypi/simple 'certbot>=5.4,<6' \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/407
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --registry=https://registry.npmmirror.com && npm cache clean --force
COPY deploy/runtime/server ./server
COPY deploy/runtime/dist ./dist
COPY public/assets/interaction-layout.json ./public/assets/interaction-layout.json
USER node
ENTRYPOINT ["node"]
CMD ["server/index.mjs"]
