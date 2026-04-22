FROM mysql:8.0-debian


RUN apt-get update \
 && apt-get install -y cron tzdata \
 && rm -rf /var/lib/apt/lists/*


ENV TZ=Africa/Tunis


COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

COPY crontab.txt /etc/cron.d/db-backup
RUN chmod 0644 /etc/cron.d/db-backup


CMD ["cron", "-f"]