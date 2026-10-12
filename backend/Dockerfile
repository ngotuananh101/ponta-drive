# ---- build ----
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/ponta-api .

# ---- runtime ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app
WORKDIR /app
COPY --from=build /out/ponta-api /app/ponta-api
COPY --from=build /src/resources /app/resources
COPY --from=build /src/public    /app/public
COPY --from=build /src/lang      /app/lang
COPY --from=build /src/config    /app/config
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /app/storage \
    && chown -R app /app/storage
USER app
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
