# Python CAD Engine - Production Dockerfile with Conda
# Uses OpenCascade Technology (OCCT) for STEP file processing

FROM continuumio/miniconda3:24.9.2-0

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Create conda environment with pythonocc-core
RUN conda create -n cad-env python=3.11 -y && \
    conda install -n cad-env -c conda-forge pythonocc-core=7.7.2 -y && \
    conda clean -afy

# Activate conda environment and install additional packages
SHELL ["conda", "run", "-n", "cad-env", "/bin/bash", "-c"]
# Install heavy conda-forge packages (OCCT-compatible ABI pins)
RUN conda install -n cad-env -c conda-forge \
    fastapi=0.109.0 \
    uvicorn=0.27.0 \
    slowapi=0.1.9 \
    pydantic=2.5.3 \
    python-multipart=0.0.6 \
    aiofiles=23.2.1 \
    httpx=0.26.0 \
    python-json-logger=2.0.7 \
    python-dotenv=1.0.1 \
    libmagic=5.45 -y && \
    conda clean -afy

# Copy requirements first so pip layer is cached independently of source changes
COPY requirements.txt ./

# Install remaining Python deps — pip handles packages not available on conda-forge.
# python-magic-bin is Windows-only; libmagic was already installed above via conda.
RUN conda run -n cad-env pip install \
    --no-cache-dir \
    anthropic==0.18.1 \
    "openai>=1.35.0" \
    python-magic==0.4.27 \
    requests

# Copy all application source (copilot package, feature extractors, converters, knowledge)
COPY . .

# Create default .env configuration (can be overridden by environment variables)
RUN echo "# CAD Engine Configuration" > .env && \
    echo "HOST=0.0.0.0" >> .env && \
    echo "PORT=5000" >> .env && \
    echo "LOG_LEVEL=INFO" >> .env && \
    echo "ENVIRONMENT=production" >> .env && \
    echo "MAX_FILE_SIZE_MB=50" >> .env && \
    echo "RATE_LIMIT_PER_MINUTE=10" >> .env && \
    echo "LINEAR_DEFLECTION=0.1" >> .env && \
    echo "ANGULAR_DEFLECTION=0.5" >> .env && \
    echo "TEMP_DIR=/tmp/cad_engine" >> .env && \
    echo "ANTHROPIC_API_KEY=" >> .env && \
    echo "CLAUDE_MODEL=claude-3-5-sonnet-20241022" >> .env && \
    echo "BYPASS_CAD_FORMAT_CHECK=false" >> .env

# Create temp directory for CAD conversions
RUN mkdir -p /tmp/cad-files

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Run with conda environment
CMD ["conda", "run", "--no-capture-output", "-n", "cad-env", "python", "main.py"]
