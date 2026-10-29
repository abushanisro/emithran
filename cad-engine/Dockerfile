# Python CAD Engine - Production Dockerfile with Conda
# Uses OpenCascade Technology (OCCT) for STEP file processing

FROM continuumio/miniconda3:26.7.1-1@sha256:eca594d684f495c1a02beff33a9fab53aec8c5830eaf431bb149912dc6c9e4c1

# Install system dependencies
# libmagic1 provides the native shared library required by python-magic
# This container parses untrusted uploaded CAD files, so OS packages are brought to their patched versions at build time.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Create conda environment with pythonocc-core
RUN conda create -n cad-env python=3.11 -y && \
    conda install -n cad-env -c conda-forge pythonocc-core=7.7.2 -y && \
    conda clean -afy

# conda's own base environment is never used to run the service (that is cad-env), but it ships in the image, so it is brought to
# its patched versions too.
RUN conda update -y -n base -c conda-forge --all && conda clean -afy

# Activate conda environment and install additional packages
SHELL ["conda", "run", "-n", "cad-env", "/bin/bash", "-c"]
# Copy requirements first so pip layer is cached independently of source changes
COPY requirements.txt ./

# Every Python dependency except pythonocc-core comes from requirements.txt, the
# one pinned list (and the one dependency scanners read), so the image runs
# exactly the versions that are declared and patched. It used to conda-install
# its own older pins here (python-multipart 0.0.6, fastapi 0.109) and copy
# requirements.txt without using it.
# python-magic-bin / pywin32 carry Windows-only markers; libmagic1 is installed above.
RUN conda run -n cad-env pip install --no-cache-dir -r requirements.txt

# Copy all application source (feature extractors, converters)
COPY . .

# Create default .env configuration (can be overridden by environment variables)
RUN echo "# CAD Engine Configuration" > .env && \
    echo "HOST=0.0.0.0" >> .env && \
    echo "PORT=5055" >> .env && \
    echo "LOG_LEVEL=INFO" >> .env && \
    echo "ENVIRONMENT=production" >> .env && \
    echo "NODE_ENV=production" >> .env && \
    echo "MAX_FILE_SIZE_MB=50" >> .env && \
    echo "RATE_LIMIT_PER_MINUTE=10" >> .env && \
    echo "LINEAR_DEFLECTION=0.1" >> .env && \
    echo "ANGULAR_DEFLECTION=0.5" >> .env && \
    echo "TEMP_DIR=/tmp/cad_engine" >> .env && \
    echo "ANTHROPIC_API_KEY=" >> .env && \
    echo "CLAUDE_MODEL=claude-3-5-sonnet-20241022" >> .env && \
    echo "BYPASS_CAD_FORMAT_CHECK=false" >> .env

# Create temp directory for CAD conversions
RUN mkdir -p /tmp/cad-files /app/logs

# The running service needs no package installer. Removing pip from both environments also removes the copies of urllib3 and
# msgpack that pip vendors (they are scanned and reported even though nothing at runtime uses them).
RUN conda remove -y --force -n cad-env pip setuptools wheel; conda remove -y --force -n base pip setuptools wheel; conda clean -afy; true

# Run as an unprivileged user: this process parses untrusted uploaded CAD files.
RUN useradd --system --uid 10002 --create-home --home-dir /home/cad cad && chown -R cad:cad /app /tmp/cad-files /home/cad
USER cad
ENV HOME=/home/cad

# Expose port
EXPOSE 5055

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5055/health || exit 1

# Run with conda environment
CMD ["conda", "run", "--no-capture-output", "-n", "cad-env", "python", "main.py"]
