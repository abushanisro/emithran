# Python CAD Engine - Production Dockerfile with Conda
# Uses OpenCascade Technology (OCCT) for STEP file processing

FROM continuumio/miniconda3:24.9.2-0

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Create conda environment with pythonocc-core
RUN conda create -n cad-env python=3.11 -y && \
    conda install -n cad-env -c conda-forge pythonocc-core=7.7.2 -y && \
    conda clean -afy

# Activate conda environment and install additional packages
SHELL ["conda", "run", "-n", "cad-env", "/bin/bash", "-c"]
# Install Python deps into cad-env (CORRECT)
RUN conda install -n cad-env -c conda-forge \
    fastapi=0.109.0 \
    uvicorn=0.27.0 \
    slowapi=0.1.9 \
    pydantic=2.5.3 \
    python-multipart=0.0.6 \
    aiofiles=23.2.1 \
    httpx=0.26.0 \
    python-json-logger=2.0.7 -y && \
    conda clean -afy

# Install Google Generative AI SDK and requests (needed for AI DFM analysis)
RUN conda run -n cad-env pip install google-generativeai requests --no-cache-dir

# Copy application code — includes AI DFM analyzer
COPY main.py config.py services.py validators.py exceptions.py memory_optimizer.py ai_dfm_analyzer.py ./

# Copy .env for default configuration (API key can be overridden by Docker -e flags)
COPY .env .env

# Create temp directory for CAD conversions
RUN mkdir -p /tmp/cad-files

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Run with conda environment
CMD ["conda", "run", "--no-capture-output", "-n", "cad-env", "python", "main.py"]
