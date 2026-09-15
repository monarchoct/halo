ARG BUILD_IMAGE=ubuntu@sha256:a61567bd31828687156d735ea8eb01ba4e37636e225dd6a48ba94136a70d9d61
ARG RUN_IMAGE=ubuntu@sha256:a61567bd31828687156d735ea8eb01ba4e37636e225dd6a48ba94136a70d9d61
FROM ${BUILD_IMAGE} AS build
ARG GPU=OFF
ARG CUDA_ARCH=89
RUN apt-get update && apt-get install -y --no-install-recommends gcc-14 g++-14 cmake make libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY llama-source.tar.gz /tmp/llama-source.tar.gz
RUN echo '2de0d87eda4696e9f6bbd771d4c623267f4e95856cce6f99793f91522f993e43  /tmp/llama-source.tar.gz' | sha256sum -c - && mkdir /source && tar -xzf /tmp/llama-source.tar.gz --strip-components=1 -C /source
WORKDIR /source
ENV CC=gcc-14 CXX=g++-14
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DGGML_CUDA=${GPU} -DCMAKE_CUDA_ARCHITECTURES=${CUDA_ARCH} -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_APP=OFF -DLLAMA_BUILD_UI=OFF -DLLAMA_USE_PREBUILT_UI=OFF -DLLAMA_SUBPROCESS=OFF && cmake --build build --target llama-server -j2
FROM ${RUN_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libgomp1 libssl3t64 ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /source/build/bin/ /opt/halo/bin/
COPY entrypoint.sh /opt/halo/entrypoint.sh
RUN chmod 0555 /opt/halo/entrypoint.sh
LABEL org.opencontainers.image.source="https://github.com/ggml-org/llama.cpp" org.opencontainers.image.revision="5266f24da75dc449bd56cbed7addb9c8e4a6a73e"
ENV LD_LIBRARY_PATH=/opt/halo/bin:/usr/local/nvidia/lib:/usr/local/nvidia/lib64 HOME=/tmp HALO_REQUIRE_GPU=1
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["/opt/halo/entrypoint.sh"]
