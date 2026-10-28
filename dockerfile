FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV GIT_LFS_SKIP_SMUDGE=1


RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app


RUN git clone https://github.com/xai-org/xai-cookbook.git .
RUN git lfs install
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync


RUN uv run pre-commit install

RUN cp .env.example .env

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8888

CMD ["uv", "run", "jupyter", "notebook", "examples/", "--ip=0.0.0.0", "--no-browser", "--allow-root"]

# To build the Docker image, run:
#docker build -t xai-cookbook .
# to run the Docker container, use:
#docker run -p 8888:8888 xai-cookbook