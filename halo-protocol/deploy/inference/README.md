# Portable HALO inference

This packages the **existing** Qwen3.5-4B Q8_0 baseline for Linux. It keeps the
same public model hash, runtime source commit, alias, proposal schema and prompts.
It does not alter activated manifests or claim bit-identical outputs across GPUs.
The public proposal release remains the model authority; `linux.lock.json` records
the additional platform build inputs. vLLM can be added for evaluated model formats
later; replacing the running GGUF model just to change its host is unnecessary.

## Build

Use a Linux amd64 build host with Docker. Download `source.url` from
`linux.lock.json` as `llama-source.tar.gz` into this directory. The Docker build
checks its exact SHA-256 before extracting it. The context should contain only
the Dockerfile, entrypoint and public source archive; never model credentials.

For a CPU **diagnostic** image, run `docker build -t halo-inference:cpu .`.
To prepare the CUDA image, pass these arguments to the same build:

```sh
docker build -t halo-inference:cuda \
  --build-arg GPU=ON --build-arg CUDA_ARCH=89 \
  --build-arg BUILD_IMAGE=nvidia/cuda@sha256:4b9ed5fa8361736996499f64ecebf25d4ec37ff56e4d11323ccde10aa36e0c43 \
  --build-arg RUN_IMAGE=nvidia/cuda@sha256:828c4d878adcaa4265d80c95d8ec877149b49bb2419a4cf3bb6aa889bbb7ca2e .
```

The initial CUDA build targets Ada compute capability 8.9. Choose a matching GPU
provider; a different architecture requires a separately built and tested image.
OS image digests and source are pinned. Ubuntu package repository snapshots are
not yet pinned, so the final reviewed image digest is the deployment artifact.
Publish it only after build, model, isolation and provider acceptance. No registry
or cloud deployment has been created by these files.

## Runtime

Mount `Qwen_Qwen3.5-4B-Q8_0.gguf` from the existing asset lock read-only under
`/models`. Startup checks its size and full SHA-256 before serving. Mount a private
file containing a freshly generated 64-character hexadecimal API key under
`/run/secrets/inference-key`, readable by UID 1000. Do not reuse a wallet key.
No model download or cloud credential is needed inside the running container.

Set `HALO_INFERENCE_IMAGE` to the reviewed CUDA image digest,
`HALO_MODEL_DIRECTORY` to that model directory and `HALO_INFERENCE_KEY_FILE` to
the key file, then use `docker compose -f compose.yaml up -d` on the GPU host.
The service defaults to requiring a visible NVIDIA GPU. Two server slots share a
32,768-token total context allocation. CPU diagnostic mode is explicit via
`HALO_REQUIRE_GPU=0`; it is not an automatic production fallback.

The service binds only host loopback port 8082. Put it behind a separately
configured authenticated HTTPS gateway for remote operators, with request-size,
rate, concurrency and timeout limits. Never open this raw port publicly. Configure
HALO's existing inference client with that HTTPS `/v1` URL and scoped bearer key.
Do not put a provider key in agent manifests or the website. A second provider
uses a different key and independently mounted copies of the same model.

## Required acceptance

- Build the CPU and CUDA targets and record source/image digests.
- Confirm non-root startup, read-only mounts, missing/corrupt model rejection,
  mandatory API authentication and refusal when required GPUs are absent.
- Check `/v1/models` and a real structured proposal against the pinned alias and
  existing HALO model adapter. A binary version check is insufficient.
- Measure warm/cold latency, bounded queue behavior and GPU memory with both slots.
- Exercise provider failure and operator retry without duplicate paid chain work.
- Measure the 100-agent schedule on the actual hosts; the local CPU proof
  benchmark is not an inference or hosted-capacity result.

The upstream project documents separate CPU/CUDA server builds and notes that GPU
images need runtime testing beyond CI compilation. HALO therefore builds its exact
existing source version and leaves GPU acceptance explicit. References:
[upstream Docker guidance](https://github.com/ggml-org/llama.cpp/blob/5266f24da75dc449bd56cbed7addb9c8e4a6a73e/docs/docker.md),
[source release](https://github.com/ggml-org/llama.cpp/releases/tag/b10809).
