# Ethara Service Hub (TMS) database — PostgreSQL 15 with the platform data
# preloaded. On the FIRST start of a new container (empty data volume) the
# bundled dump is restored automatically; later starts reuse the volume.
FROM postgres:15

ENV POSTGRES_DB=ticketflow_local \
    POSTGRES_USER=ticketflow_app
# POSTGRES_PASSWORD is deliberately NOT baked in — pass it with -e at `docker run`.

COPY --chmod=0644 tms.dump /opt/tms/tms.dump
COPY --chmod=0755 10-restore-tms.sh /docker-entrypoint-initdb.d/10-restore-tms.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=30m --retries=3 \
  CMD ["sh", "-c", "pg_isready -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\""]

LABEL org.opencontainers.image.title="tms-db" \
      org.opencontainers.image.description="Ethara Service Hub PostgreSQL 15 database snapshot"
