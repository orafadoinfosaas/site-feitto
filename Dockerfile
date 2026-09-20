# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build
#
# As variáveis PUBLIC_* do Astro são resolvidas AQUI, não no runtime: o site é
# estático, então o valor entra no JavaScript durante o build. Por isso elas
# são ARG e não ENV — passar como variável de ambiente do contêiner não teria
# efeito nenhum, o bundle já estaria pronto.
#
# No EasyPanel: Build → Build Arguments.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build

ARG PUBLIC_DIAGNOSTICO_ENDPOINT=""
ARG PUBLIC_NOINDEX="false"
ENV PUBLIC_DIAGNOSTICO_ENDPOINT=$PUBLIC_DIAGNOSTICO_ENDPOINT
ENV PUBLIC_NOINDEX=$PUBLIC_NOINDEX

WORKDIR /app

# o sharp traz binários próprios; libc6-compat evita o erro de glibc no alpine
RUN apk add --no-cache libc6-compat

# a camada de dependências só é refeita quando o package muda
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime
#
# nginx sem root: o unprivileged serve na 8080 e não precisa de CAP_NET_BIND.
# ---------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

LABEL org.opencontainers.image.title="Site FEITTO"
LABEL org.opencontainers.image.source="https://github.com/orafadoinfosaas/site-feitto"

COPY --chown=nginx:nginx docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --chown=nginx:nginx docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
