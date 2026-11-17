# ecad-engine: electronics design-file extraction service. Pure Python (no OpenCascade), so a slim image.
FROM python:3.15-slim@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928

# Debian security fixes that landed after the base image was built (as in cad-engine and core): the pinned digest is reproducible, the patches are not in it yet.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=5100
WORKDIR /app

COPY requirements.txt ./
# pip and setuptools are only needed to install: removed afterwards, so the copies of msgpack, urllib3 and others they carry inside
# themselves (which nothing in the service imports, and which lag behind their fixed releases) are not in the image that runs.
RUN pip install --no-cache-dir -r requirements.txt \
    && (pip uninstall -y setuptools || true) \
    && pip uninstall -y pip

# Only the service code. Test data (customer board files) and tests are not shipped.
COPY main.py config.py telemetry.py ./
COPY parsers ./parsers
COPY extraction ./extraction

RUN useradd --system --uid 10001 ecad && chown -R ecad /app
USER ecad

EXPOSE 5100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request,os;urllib.request.urlopen('http://localhost:'+os.environ.get('PORT','5100')+'/health')" || exit 1
CMD ["python", "main.py"]
