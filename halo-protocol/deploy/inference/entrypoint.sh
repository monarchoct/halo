#!/bin/sh
set -eu
[ "$(id -u)" != 0 ] || { echo 'Inference must run as a non-root user' >&2; exit 1; }
if [ "${1:-}" = check-binary ]; then
  exec /opt/halo/bin/llama-server --version
fi
[ "$#" = 0 ] || { echo 'Unrecognized inference startup mode' >&2; exit 1; }
model=/models/Qwen_Qwen3.5-4B-Q8_0.gguf
key=/run/secrets/inference-key
[ -f "$model" ] && [ "$(stat -c %s "$model")" = 4622131168 ] || { echo 'Pinned model is missing or has the wrong size' >&2; exit 1; }
echo "5c74c0ede371924357dff0cb6ba145bd67208b9b2389ded681adfff3f7608db7  $model" | sha256sum -c - >/dev/null
[ -r "$key" ] && [ "$(stat -c %s "$key")" -ge 64 ] && [ "$(stat -c %s "$key")" -le 65 ] && grep -Eq '^[a-f0-9]{64}$' "$key" || { echo 'A private 64-character API key file is required' >&2; exit 1; }
case "${HALO_REQUIRE_GPU:-1}" in
  1) nvidia-smi -L >/dev/null 2>&1 || { echo 'CUDA hosting requires an available NVIDIA GPU' >&2; exit 1; }; layers=99; slots=2; context=32768 ;;
  0) layers=0; slots=1; context=16384 ;;
  *) echo 'Invalid GPU requirement' >&2; exit 1 ;;
esac
exec /opt/halo/bin/llama-server --model "$model" --alias halo-qwen35-4b-v1 --host 0.0.0.0 --port 8080 --api-key-file "$key" --ctx-size "$context" --parallel "$slots" --n-gpu-layers "$layers" --flash-attn on --cache-type-k f16 --cache-type-v f16 --no-context-shift --no-agent --no-webui --cors-origins http://127.0.0.1:8080
