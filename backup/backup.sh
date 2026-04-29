#!/bin/bash
set -e

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-pfe_user}"
DB_PASSWORD="${DB_PASSWORD:-pfe_pass}"
DB_NAME="${DB_NAME:-isam_dash}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_ROOT="${BACKUP_PATH:-/backups}"

DATE_DIR=$(date +%F)
BACKUP_DIR="${BACKUP_ROOT}/${DATE_DIR}"
DATE_TIME=$(date +%F_%H-%M-%S)
FILENAME="${DB_NAME}-${DATE_TIME}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting MySQL dump → ${FILEPATH}"

mysqldump \
  -h "${DB_HOST}" \
  -P "${DB_PORT}" \
  -u "${DB_USER}" \
  -p"${DB_PASSWORD}" \
  --no-tablespaces \
  --single-transaction \
  --routines \
  --triggers \
  "${DB_NAME}" | gzip > "${FILEPATH}"

echo "[$(date)] Dump complete. Size: $(du -sh "${FILEPATH}" | cut -f1)"

# Remove old backups
echo "[$(date)] Removing backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_ROOT}" -type f -name "*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete
# Remove empty dated directories
find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -empty -delete
echo "[$(date)] Cleanup done."