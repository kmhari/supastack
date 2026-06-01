# supastack Caddy — custom build with caddy-l4 module.
#
# This is the FIRST supastack feature requiring a custom Caddy image. Feature 004
# (wildcard cert via DNS-01) deliberately stayed on stock caddy:2.8-alpine by
# using acme-client (npm) + tls.certificates.load_files. Feature 005 introduces
# Postgres SNI routing on :5432 which requires the caddy-l4 module — not part
# of the stock Caddy distribution.
#
# The caddy-l4 module adds a `layer4` app to Caddy's JSON config, providing:
#   - TCP listeners on arbitrary ports (here: :5432)
#   - TLS termination using Caddy's existing cert store (incl. wildcard from #004)
#   - Postgres STARTTLS handling (l4postgres) — reads SSLRequest, responds 'S'
#   - SNI-based routing to per-instance Postgres upstreams
#
# Module reference: https://github.com/mholt/caddy-l4

FROM caddy:2.11-builder AS builder
# caddy-l4 v0.1.1+ requires Caddy ≥ 2.11.3 and Go ≥ 1.25.
# GOTOOLCHAIN=auto lets Go auto-download the right toolchain version.
ENV GOTOOLCHAIN=auto
RUN xcaddy build \
    --with github.com/mholt/caddy-l4

FROM caddy:2.11-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
