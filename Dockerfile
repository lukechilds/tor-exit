FROM debian:trixie-slim AS builder

ARG TOR_VERSION=0.4.8.21

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential automake autoconf libtool pkg-config \
    libevent-dev libssl-dev zlib1g-dev ca-certificates wget && \
    rm -rf /var/lib/apt/lists/*

RUN wget -q "https://dist.torproject.org/tor-${TOR_VERSION}.tar.gz" && \
    tar xf "tor-${TOR_VERSION}.tar.gz" && \
    cd "tor-${TOR_VERSION}" && \
    ./configure --disable-asciidoc --sysconfdir=/etc --disable-unittests && \
    make -j$(nproc) && \
    make install DESTDIR=/build

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libevent-2.1-7 libssl3 zlib1g nyx && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/usr/local/ /usr/local/

ENTRYPOINT "tor"
