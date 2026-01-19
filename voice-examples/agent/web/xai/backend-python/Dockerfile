# LFM-Enhanced Secure Container for Voice Agent Backend
# COPYRIGHT © 2025 KEITH LUTON. ALL RIGHTS RESERVED.
# Author: Keith Luton

# Use a slim Python image for security and efficiency
FROM python:3.13-slim as builder

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Set work directory
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Final stage
FROM python:3.13-slim

# Create a non-root user for security
RUN groupadd -r lfmuser && useradd -r -g lfmuser lfmuser

# Set work directory
WORKDIR /app

# Copy only the necessary files from the builder
COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .

# Set ownership to the non-root user
RUN chown -R lfmuser:lfmuser /app

# Switch to non-root user
USER lfmuser

# Expose the application port
EXPOSE 8000

# Healthcheck to ensure container stability
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import httpx; import sys; response = httpx.get('http://localhost:8000/health'); sys.exit(0 if response.status_code == 200 else 1)"]

# Start the application using uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
