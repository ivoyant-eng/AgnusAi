FROM ubuntu:24.04

RUN apt-get update && apt-get install -y curl ca-certificates git nodejs && rm -rf /var/lib/apt/lists/*

# Install opencode via official installer
RUN curl -fsSL https://opencode.ai/install | bash

ENV PATH="/root/.opencode/bin:$PATH"

COPY azure-proxy.js /usr/local/bin/azure-proxy.js
COPY opencode-entrypoint.sh /usr/local/bin/opencode-entrypoint.sh
RUN chmod +x /usr/local/bin/opencode-entrypoint.sh

EXPOSE 4096

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint.sh"]
CMD ["/root/.opencode/bin/opencode", "serve"]
