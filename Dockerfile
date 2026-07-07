FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/app

COPY pyproject.toml README.md ./
COPY app ./app
COPY config ./config
COPY scripts ./scripts
COPY migrations ./migrations
COPY alembic.ini ./

RUN pip install .

RUN mkdir -p /srv/app/data

EXPOSE 8000

CMD ["python", "-m", "app.main"]
