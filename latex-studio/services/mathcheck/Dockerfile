FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /service

# Install a CPU-only build of torch first (the default index pulls the large CUDA
# build). Keeps the image lean; sentence-transformers then resolves against it.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch>=2.2"

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The embedding model (BAAI/bge-small-en-v1.5) downloads from Hugging Face on first
# use and is cached here. To pre-bake it into the image (fully offline at runtime),
# uncomment:
# RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-small-en-v1.5')"
ENV HF_HOME=/service/.hf_cache

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
