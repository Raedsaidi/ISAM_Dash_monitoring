FROM mysql:8.0-debian


RUN apt-get update \
 && apt-get install -y cron tzdata \
 && rm -rf /var/lib/apt/lists/*

# Set timezone to Tunis
ENV TZ=Africa/Tunis
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh


COPY crontab.txt /etc/cron.d/db-backup
RUN chmod 0644 /etc/cron.d/db-backup 

RUN touch /var/log/backup.log

CMD cron -f & tail -f /var/log/backup.log