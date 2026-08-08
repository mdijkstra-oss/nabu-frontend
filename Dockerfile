FROM node:22-alpine AS build

WORKDIR /src

# postinstall copies jq here, and it runs before the sources arrive.
RUN mkdir -p public

# Their own layer, so editing a source file does not reinstall the tree.
# --legacy-peer-deps because @subframe/core's peer range stops at sonner 1, and
# the app is on 2. The two disagree about a toast library neither of them owns.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Baked into the bundle, not read at run time: this is a static build with no
# server to read an environment from. Pointing it at a different backend is a
# rebuild. Left unset, each falls through to the default in app/lib/*/env.ts.
ARG VITE_API_HOST
ARG VITE_LLM_HOST
ARG VITE_EMBEDDINGS_URL
ARG VITE_EMBEDDINGS_MODEL
ARG VITE_EMBEDDINGS_DIMENSIONS
ENV VITE_API_HOST=$VITE_API_HOST \
    VITE_LLM_HOST=$VITE_LLM_HOST \
    VITE_EMBEDDINGS_URL=$VITE_EMBEDDINGS_URL \
    VITE_EMBEDDINGS_MODEL=$VITE_EMBEDDINGS_MODEL \
    VITE_EMBEDDINGS_DIMENSIONS=$VITE_EMBEDDINGS_DIMENSIONS

RUN npm run build

FROM caddy:2-alpine

COPY --from=build /src/build/client /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
