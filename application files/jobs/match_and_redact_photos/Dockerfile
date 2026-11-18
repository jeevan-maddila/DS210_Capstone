ARG HF_MODEL_REVISION=af6d057
FROM python:3.11-slim AS build
ARG HF_MODEL_REVISION
ENV HF_MODEL_REVISION=${HF_MODEL_REVISION}
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt
RUN PYTHONPATH=/install/lib/python3.11/site-packages python -c \
    "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='fal/AuraFace-v1', revision=os.environ['HF_MODEL_REVISION'], local_dir='/model-cache', allow_patterns=['glintr100.onnx', 'scrfd_10g_bnkps.onnx'])"

FROM python:3.11-slim
ARG HF_MODEL_REVISION
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    MODEL_ROOT=/app HF_MODEL_REVISION=${HF_MODEL_REVISION} HF_LOCAL_FILES_ONLY=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /install /usr/local
COPY --from=build /model-cache /app/models/auraface
COPY main.py ./
USER 65532:65532
ENTRYPOINT ["python", "main.py"]
