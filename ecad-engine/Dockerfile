# ecad-engine: electronics design-file extraction service. Pure Python (no OpenCascade), so a slim image.
FROM python:3.14-slim@sha256:cd89c30eda26ee911a4611b18680086e0ea42e6f5f8cbe653d07fa7958c9cec8

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=5100
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Only the service code. Test data (customer board files) and tests are not shipped.
COPY main.py config.py telemetry.py ./
COPY parsers ./parsers
COPY extraction ./extraction

RUN useradd --system --uid 10001 ecad && chown -R ecad /app
USER ecad

EXPOSE 5100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request,os;urllib.request.urlopen('http://localhost:'+os.environ.get('PORT','5100')+'/health')" || exit 1
CMD ["python", "main.py"]
