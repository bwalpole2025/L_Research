# Sandbox image for the Python "Run" feature. Each run is a throwaway
# `docker run --rm` from this image (non-root, resource/time-limited, network off
# by default — see ADR-013). It only needs the scientific stack; the project's
# files are bind-mounted at /workspace at run time.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/mpl

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# GNUplot for the diagram editor's plot elements (same sandbox discipline as
# Python runs — see ADR-013 and run/gnuplot.ts). The Debian build ships the
# LaTeX-native `cairolatex` terminal used for document-font-matching plots.
RUN apt-get update && apt-get install -y --no-install-recommends gnuplot-nox && rm -rf /var/lib/apt/lists/*

# A non-root user owns nothing the host cares about; runs also pass --user, but a
# baked user keeps the image safe even if --user is omitted.
RUN useradd --create-home --uid 1000 runner
USER runner

WORKDIR /workspace

# Kept alive by the compose service so `docker compose up` builds/pulls the image;
# real executions use `docker run` (see apps/api/src/run/runner.ts).
CMD ["python3", "-c", "import time; time.sleep(10**9)"]
