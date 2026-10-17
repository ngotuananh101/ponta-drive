# ===================================================
# Stage 1: Build Backend (Go 1.25)
# ===================================================
FROM golang:1.25-bookworm AS backend-build
WORKDIR /src

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux ${TARGETARCH:+GOARCH=$TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/ponta-api .

# ===================================================
# Stage 2: Build Frontend (Vue 3 + Bun 1.4)
# ===================================================
FROM oven/bun:1.4.2 AS frontend-build
WORKDIR /app

COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY frontend/ .
RUN bun run build-only

# ===================================================
# Stage 3: Runtime Image (Alpine 3.20 + Nginx)
# ===================================================
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata nginx curl \
    && mkdir -p /run/nginx

WORKDIR /app

# Copy compiled backend binary and runtime asset directories
COPY --from=backend-build /out/ponta-api /app/ponta-api
COPY --from=backend-build /src/resources /app/resources
COPY --from=backend-build /src/public    /app/public
COPY --from=backend-build /src/lang      /app/lang
COPY --from=backend-build /src/config    /app/config

# Copy compiled frontend SPA static assets to Nginx webroot
COPY --from=frontend-build /app/dist /usr/share/nginx/html

# Copy Nginx configuration and entrypoint script
COPY deploy/nginx.conf /etc/nginx/http.d/default.conf
COPY deploy/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /app/storage

EXPOSE 8080
VOLUME ["/app/storage"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:8080/ping || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
