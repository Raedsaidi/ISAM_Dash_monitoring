#!/bin/bash
set -e

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-pfe_user}"
DB_PASSWORD="${DB_PASSWORD:-pfe_pass}"
DB_NAME="${DB_NAME:-isam_dash}"

RETENTION_DAYS="${RETENTION_DAYS:-28}"

BACKUP_ROOT="/backups"

DATE_DIR=$(date +%F)
BACKUP_DIR="${BACKUP_ROOT}/${DATE_DIR}"

DATE_TIME=$(date +%F_%H-%M-%S)
FILENAME="${DB_NAME}-${DATE_TIME}.sql"
FILEPATH="${BACKUP_DIR}/${FILENAME}"


mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Démarrage du dump MySQL vers ${FILEPATH}"

mysqldump \
  -h "${DB_HOST}" \
  -P "${DB_PORT}" \
  -u "${DB_USER}" \
  -p"${DB_PASSWORD}" \
  --no-tablespaces \
  "${DB_NAME}" > "${FILEPATH}"

echo "[$(date)] Dump terminé."

echo "[$(date)] Suppression des backups de plus de ${RETENTION_DAYS} jours..."
find "${BACKUP_ROOT}" -type f -name "*.sql" -mtime +"${RETENTION_DAYS}" -exec rm {} \; || true
echo "[$(date)] Nettoyage terminé."