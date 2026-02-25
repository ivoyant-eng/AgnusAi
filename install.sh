#!/bin/bash
set -uo pipefail

# ─── AgnusAI One-Command Installer ─────────────────────────────────────────
# Sets up AgnusAI with Traefik, configures .env interactively, and starts
# the stack. Ollama is fully optional — skip it if you use cloud providers.
# ---------------------------------------------------------------------------

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_info()    { echo -e "${BLUE}[info]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error()   { echo -e "${RED}[✗]${NC} $1" >&2; }
log_step()    { echo -e "\n${BOLD}${CYAN}── $1${NC}"; }

USE_OLLAMA_DOCKER=false
REPLY_VALUE=""

# ── Helpers ──────────────────────────────────────────────────────────────────

# ask <prompt> [default] [secret=false]
# Result is stored in $REPLY_VALUE (avoids subshell issues with read -p)
ask() {
    local prompt="$1" default="${2:-}" secret="${3:-false}"
    REPLY_VALUE=""
    if [[ "$secret" == "true" ]]; then
        read -rsp "$prompt" REPLY_VALUE || true
        echo
    else
        read -rp "$prompt" REPLY_VALUE || true
    fi
    if [[ -z "$REPLY_VALUE" ]]; then REPLY_VALUE="$default"; fi
}

# set_env <key> <value> — write or update a key in .env
set_env() {
    local key="$1" value="$2"
    if grep -q "^${key}=" .env 2>/dev/null; then
        sed -i.bak "s|^${key}=.*|${key}=${value}|" .env
        rm -f .env.bak
    else
        echo "${key}=${value}" >> .env
    fi
}

# get_env <key> [default]
get_env() {
    grep "^${1}=" .env 2>/dev/null | cut -d'=' -f2- || echo "${2:-}"
}

# ── System checks ─────────────────────────────────────────────────────────────

check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_warning "Running as root is not recommended."
        ask "Continue anyway? (y/N): " "n"
        [[ ! "$REPLY_VALUE" =~ ^[Yy]$ ]] && exit 1
    fi
}

check_os() {
    log_info "Checking OS..."
    case "$(uname -s)" in
        Darwin) log_success "macOS detected" ;;
        Linux)  log_success "Linux detected" ;;
        *)
            log_warning "Non-standard OS: $(uname -s)"
            ask "Continue? (y/N): " "n"
            [[ ! "$REPLY_VALUE" =~ ^[Yy]$ ]] && exit 1
            ;;
    esac
}

install_docker_linux() {
    log_info "Installing latest Docker CE via get.docker.com..."
    # Remove any old distro-packaged docker first
    sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null \
        || sudo yum remove -y docker docker-client docker-client-latest docker-common \
           docker-latest docker-latest-logrotate docker-logrotate docker-engine 2>/dev/null \
        || true
    curl -fsSL https://get.docker.com | sudo sh
    sudo systemctl enable docker
    sudo systemctl start docker
    sudo usermod -aG docker "$USER" || true
}

check_docker() {
    log_info "Checking Docker..."

    local need_install=false
    if ! command -v docker &>/dev/null; then
        need_install=true
    else
        # Check Docker API version — must be >= 1.44 (Docker CE 23+)
        local api_ver
        api_ver=$(docker version --format '{{.Server.APIVersion}}' 2>/dev/null \
            || sudo docker version --format '{{.Server.APIVersion}}' 2>/dev/null || echo "0")
        local major minor
        major=$(echo "$api_ver" | cut -d'.' -f1)
        minor=$(echo "$api_ver" | cut -d'.' -f2)
        if [[ "$major" -lt 1 ]] || [[ "$major" -eq 1 && "$minor" -lt 44 ]]; then
            log_warning "Docker API version $api_ver is too old (need 1.44+). Upgrading..."
            need_install=true
        fi
    fi

    if [[ "$need_install" == "true" ]]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            if command -v brew &>/dev/null; then
                brew install --cask docker
                log_info "Please start Docker Desktop from Applications, then re-run this script."
                exit 0
            else
                log_error "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
                exit 1
            fi
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            install_docker_linux
        else
            log_error "Auto-install not supported. See https://docs.docker.com/get-docker/"
            exit 1
        fi
    fi

    # Wait up to 30s for the daemon to be ready (handles post-install startup lag).
    # Use sudo as fallback — on fresh installs the user isn't in the docker group yet.
    local retries=0
    while ! docker info &>/dev/null && ! sudo docker info &>/dev/null; do
        if [[ $retries -ge 6 ]]; then
            log_error "Docker daemon did not start in time."
            log_info "Start it manually and re-run this script:"
            log_info "  sudo systemctl start docker"
            exit 1
        fi
        log_info "Waiting for Docker daemon... (${retries}/6)"
        sleep 5
        retries=$((retries + 1))
    done

    # If docker only works with sudo, set up a sudo wrapper for compose calls
    if ! docker info &>/dev/null && sudo docker info &>/dev/null; then
        log_warning "Docker requires sudo (you're not in the docker group yet)."
        log_info "This session will use 'sudo docker'. To fix permanently, log out and back in."
        # Alias for the rest of this script
        docker() { sudo docker "$@"; }
        export -f docker 2>/dev/null || true
    fi

    log_success "Docker is running"
}

check_docker_compose() {
    log_info "Checking Docker Compose..."
    if docker compose version &>/dev/null; then
        log_success "Docker Compose plugin available"
    elif command -v docker-compose &>/dev/null; then
        log_success "docker-compose available"
    else
        log_error "Docker Compose not found. See https://docs.docker.com/compose/install/"
        exit 1
    fi
}

# ── Configuration ─────────────────────────────────────────────────────────────

create_env_file() {
    log_step "Environment file"
    if [[ ! -f .env ]]; then
        [[ ! -f .env.example ]] && { log_error ".env.example not found. Are you in the AgnusAI directory?"; exit 1; }
        cp .env.example .env
        # Auto-generate secrets so users don't ship default values
        set_env "WEBHOOK_SECRET" "$(openssl rand -hex 32)"
        set_env "SESSION_SECRET" "$(openssl rand -hex 32)"
        set_env "JWT_SECRET"     "$(openssl rand -hex 32)"
        log_success ".env created with auto-generated secrets"
    else
        log_success ".env already exists (existing secrets preserved)"
    fi
}

prompt_public_url() {
    log_step "Public URL"
    echo "  The URL where your AgnusAI instance is reachable from the internet."
    echo "  Used for GitHub webhook callbacks and feedback links in PR comments."
    echo "  Examples: https://agnus.example.com  or  http://203.0.113.10:3000"
    echo

    local current
    current=$(get_env "PUBLIC_URL" "")
    # Try to detect a useful default
    local detected_ip
    detected_ip=$(hostname -I 2>/dev/null | awk '{print $1}' \
                  || ipconfig getifaddr en0 2>/dev/null \
                  || echo "localhost")
    local suggested="http://${detected_ip}:3000"
    [[ -n "$current" && "$current" != "http://localhost:3000" ]] && suggested="$current"

    ask "Public URL [${suggested}]: " "$suggested"
    local url="$REPLY_VALUE"

    if ! echo "$url" | grep -qE '^https?://'; then
        log_error "URL must start with http:// or https://"
        exit 1
    fi

    set_env "PUBLIC_URL" "$url"
    log_success "PUBLIC_URL → $url"
}

prompt_admin() {
    log_step "Admin account"
    echo "  This creates the first login on your instance."
    echo

    local current_email
    current_email=$(get_env "ADMIN_EMAIL" "admin@example.com")
    ask "Admin email [${current_email}]: " "$current_email"
    set_env "ADMIN_EMAIL" "$REPLY_VALUE"

    local current_pass
    current_pass=$(get_env "ADMIN_PASSWORD" "changeme")
    if [[ "$current_pass" == "changeme" ]]; then
        ask "Admin password (leave blank to keep 'changeme' — insecure): " "" "true"
        [[ -n "$REPLY_VALUE" ]] && set_env "ADMIN_PASSWORD" "$REPLY_VALUE"
    else
        ask "Change admin password? (y/N): " "n"
        if [[ "$REPLY_VALUE" =~ ^[Yy]$ ]]; then
            ask "New admin password: " "" "true"
            [[ -n "$REPLY_VALUE" ]] && set_env "ADMIN_PASSWORD" "$REPLY_VALUE"
        fi
    fi
    log_success "Admin account configured"
}

prompt_llm_provider() {
    log_step "LLM Provider"
    echo "  The LLM that reads your diffs and writes review comments."
    echo
    echo "  1) ollama  — Local Ollama (free, no API key)"
    echo "  2) openai  — OpenAI GPT-4o / GPT-4o-mini"
    echo "  3) claude  — Anthropic Claude"
    echo "  4) azure   — Azure OpenAI"
    echo "  5) custom  — Any OpenAI-compatible endpoint (vLLM, Together, Groq…)"
    echo

    local current
    current=$(get_env "LLM_PROVIDER" "ollama")
    ask "Select provider [1-5] (current: ${current}): " "1"
    local choice="$REPLY_VALUE"

    case "$choice" in
        1|ollama)
            set_env "LLM_PROVIDER" "ollama"
            ask "Ollama model [qwen3.5:397b-cloud]: " "qwen3.5:397b-cloud"
            set_env "LLM_MODEL" "$REPLY_VALUE"
            log_success "LLM → Ollama (${REPLY_VALUE})"
            ;;
        2|openai)
            set_env "LLM_PROVIDER" "openai"
            ask "OpenAI model [gpt-4o-mini]: " "gpt-4o-mini"
            set_env "LLM_MODEL" "$REPLY_VALUE"
            ask "OpenAI API key (sk-..., leave blank to set later in .env): " "" "true"
            set_env "OPENAI_API_KEY" "$REPLY_VALUE"
            log_success "LLM → OpenAI"
            ;;
        3|claude)
            set_env "LLM_PROVIDER" "claude"
            ask "Claude model [claude-sonnet-4-6]: " "claude-sonnet-4-6"
            set_env "LLM_MODEL" "$REPLY_VALUE"
            ask "Anthropic API key (sk-ant-..., leave blank to set later in .env): " "" "true"
            set_env "ANTHROPIC_API_KEY" "$REPLY_VALUE"
            log_success "LLM → Anthropic Claude"
            ;;
        4|azure)
            set_env "LLM_PROVIDER" "azure"
            ask "Azure deployment name [gpt-4o-mini]: " "gpt-4o-mini"
            set_env "LLM_MODEL" "$REPLY_VALUE"
            ask "Azure OpenAI endpoint (https://your-resource.cognitiveservices.azure.com/...): "
            set_env "AZURE_OPENAI_ENDPOINT" "$REPLY_VALUE"
            ask "Azure OpenAI API key (leave blank to set later in .env): " "" "true"
            set_env "AZURE_OPENAI_API_KEY" "$REPLY_VALUE"
            log_success "LLM → Azure OpenAI"
            ;;
        5|custom)
            set_env "LLM_PROVIDER" "custom"
            ask "Base URL (e.g. https://api.together.xyz/v1): "
            set_env "CUSTOM_LLM_URL" "$REPLY_VALUE"
            ask "Model name (e.g. meta-llama/Llama-3-70b-instruct): "
            set_env "LLM_MODEL" "$REPLY_VALUE"
            ask "API key (leave blank if not required): " "" "true"
            set_env "CUSTOM_LLM_API_KEY" "$REPLY_VALUE"
            log_success "LLM → Custom endpoint"
            ;;
        *)
            log_warning "Invalid choice — keeping current provider: $current"
            ;;
    esac
}

prompt_embedding_provider() {
    log_step "Embedding Provider  (optional — enables deep review depth)"
    echo "  Embeddings power semantic neighbor search via pgvector (deep mode)."
    echo "  Skip this to use standard 2-hop graph traversal with no extra cost."
    echo
    echo "  0) none    — disabled, standard depth               ← start here"
    echo "  1) ollama  — local Ollama embedding model (free)"
    echo "  2) openai  — OpenAI text-embedding-3-small"
    echo "  3) google  — Google text-embedding-004 (free tier: 1500 RPM)"
    echo "  4) azure   — Azure OpenAI embeddings"
    echo "  5) custom  — Any OpenAI-compatible embedding endpoint"
    echo

    ask "Select embedding provider [0-5] (default: 0): " "0"
    local choice="$REPLY_VALUE"

    case "$choice" in
        0|none|"")
            set_env "EMBEDDING_PROVIDER" ""
            set_env "REVIEW_DEPTH" "standard"
            log_success "Embeddings → disabled (standard depth)"
            ;;
        1|ollama)
            set_env "EMBEDDING_PROVIDER" "ollama"
            ask "Ollama embedding model [qwen3-embedding:0.6b]: " "qwen3-embedding:0.6b"
            set_env "EMBEDDING_MODEL" "$REPLY_VALUE"
            # EMBEDDING_BASE_URL is set later by prompt_ollama_setup
            set_env "REVIEW_DEPTH" "deep"
            log_success "Embeddings → Ollama (deep depth enabled)"
            ;;
        2|openai)
            set_env "EMBEDDING_PROVIDER" "openai"
            ask "OpenAI embedding model [text-embedding-3-small]: " "text-embedding-3-small"
            set_env "EMBEDDING_MODEL" "$REPLY_VALUE"
            local existing_key
            existing_key=$(get_env "OPENAI_API_KEY" "")
            if [[ -n "$existing_key" ]]; then
                ask "Reuse OpenAI API key from LLM config? (Y/n): " "y"
                if [[ "$REPLY_VALUE" =~ ^[Yy]$ ]]; then
                    set_env "EMBEDDING_API_KEY" "$existing_key"
                else
                    ask "OpenAI embedding API key: " "" "true"
                    set_env "EMBEDDING_API_KEY" "$REPLY_VALUE"
                fi
            else
                ask "OpenAI API key for embeddings (leave blank to set later): " "" "true"
                set_env "EMBEDDING_API_KEY" "$REPLY_VALUE"
            fi
            set_env "REVIEW_DEPTH" "deep"
            log_success "Embeddings → OpenAI (deep depth enabled)"
            ;;
        3|google)
            set_env "EMBEDDING_PROVIDER" "google"
            ask "Google embedding model [text-embedding-004]: " "text-embedding-004"
            set_env "EMBEDDING_MODEL" "$REPLY_VALUE"
            ask "Google API key (AIza..., leave blank to set later): " "" "true"
            set_env "EMBEDDING_API_KEY" "$REPLY_VALUE"
            set_env "REVIEW_DEPTH" "deep"
            log_success "Embeddings → Google (deep depth enabled)"
            ;;
        4|azure)
            set_env "EMBEDDING_PROVIDER" "azure"
            ask "Azure embedding deployment name [text-embedding-ada-002]: " "text-embedding-ada-002"
            set_env "EMBEDDING_MODEL" "$REPLY_VALUE"
            ask "Azure embedding endpoint URL: "
            set_env "EMBEDDING_BASE_URL" "$REPLY_VALUE"
            local existing_key
            existing_key=$(get_env "AZURE_OPENAI_API_KEY" "")
            if [[ -n "$existing_key" ]]; then
                ask "Reuse Azure API key from LLM config? (Y/n): " "y"
                if [[ "$REPLY_VALUE" =~ ^[Yy]$ ]]; then
                    set_env "EMBEDDING_API_KEY" "$existing_key"
                else
                    ask "Azure embedding API key: " "" "true"
                    set_env "EMBEDDING_API_KEY" "$REPLY_VALUE"
                fi
            else
                ask "Azure embedding API key (leave blank to set later): " "" "true"
                set_env "EMBEDDING_API_KEY" "$REPLY_VALUE"
            fi
            set_env "REVIEW_DEPTH" "deep"
            log_success "Embeddings → Azure OpenAI (deep depth enabled)"
            ;;
        5|custom)
            set_env "EMBEDDING_PROVIDER" "http"
            ask "Embedding base URL (e.g. https://api.cohere.com/compatibility/v1): "
            set_env "EMBEDDING_BASE_URL" "$REPLY_VALUE"
            ask "Embedding model name (e.g. embed-v4.0): "
            set_env "EMBEDDING_MODEL" "$REPLY_VALUE"
            ask "API key (leave blank if not required): " "" "true"
            set_env "EMBEDDING_API_KEY" "$REPLY_VALUE"
            set_env "REVIEW_DEPTH" "deep"
            log_success "Embeddings → Custom endpoint (deep depth enabled)"
            ;;
        *)
            log_warning "Invalid choice — disabling embeddings"
            set_env "EMBEDDING_PROVIDER" ""
            set_env "REVIEW_DEPTH" "standard"
            ;;
    esac
}

# Called only when at least one provider is "ollama"
prompt_ollama_setup() {
    log_step "Ollama Setup"
    echo "  Ollama can run on your host machine or as a Docker container."
    echo
    echo "  1) Host machine — you run 'ollama serve' yourself (recommended for GPU hosts)"
    echo "  2) Docker       — ollama container added to docker compose (easiest setup)"
    echo

    ask "Where should Ollama run? [1/2] (default: 1): " "1"

    if [[ "$REPLY_VALUE" == "2" ]]; then
        USE_OLLAMA_DOCKER=true
        local base="http://ollama:11434"
        set_env "OLLAMA_BASE_URL" "${base}/v1"
        local emb_prov
        emb_prov=$(get_env "EMBEDDING_PROVIDER" "")
        [[ "$emb_prov" == "ollama" ]] && set_env "EMBEDDING_BASE_URL" "$base"

        # GPU detection
        local use_gpu="false"
        if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
            log_info "NVIDIA GPU detected!"
            ask "Enable GPU acceleration for Ollama? (Y/n): " "y"
            [[ "$REPLY_VALUE" =~ ^[Yy]$ ]] && use_gpu="true"
        fi

        generate_ollama_override "$use_gpu"
        log_success "Ollama → Docker container (docker-compose.override.yml created)"
        log_info "Models are pulled automatically on first use by Ollama"
    else
        local base="http://host.docker.internal:11434"
        set_env "OLLAMA_BASE_URL" "${base}/v1"
        local emb_prov
        emb_prov=$(get_env "EMBEDDING_PROVIDER" "")
        [[ "$emb_prov" == "ollama" ]] && set_env "EMBEDDING_BASE_URL" "$base"
        log_success "Ollama → host machine"

        local llm_model emb_model
        llm_model=$(get_env "LLM_MODEL" "")
        emb_model=$(get_env "EMBEDDING_MODEL" "")
        echo
        log_info "On your host, make sure Ollama is running:"
        log_info "  ollama serve"
        [[ -n "$llm_model" ]] && log_info "  ollama pull ${llm_model}"
        [[ -n "$emb_model" && "$emb_model" != "$llm_model" ]] && \
            log_info "  ollama pull ${emb_model}"
    fi
}

generate_ollama_override() {
    local use_gpu="$1"
    local gpu_block=""

    if [[ "$use_gpu" == "true" ]]; then
        gpu_block="
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]"
    fi

    cat > docker-compose.override.yml << OVERRIDE
# Generated by install.sh — Ollama service
# Delete this file if you switch to a cloud LLM/embedding provider.
services:
  ollama:
    image: ollama/ollama:latest
    volumes:
      - ollama-data:/root/.ollama
    ports:
      - "11434:11434"
    restart: unless-stopped
    networks:
      - agnus-network${gpu_block}

  agnus:
    depends_on:
      - ollama

volumes:
  ollama-data:
OVERRIDE
}


show_summary() {
    local provider model embedding depth url admin_email
    provider=$(get_env "LLM_PROVIDER" "?")
    model=$(get_env "LLM_MODEL" "?")
    embedding=$(get_env "EMBEDDING_PROVIDER" "")
    depth=$(get_env "REVIEW_DEPTH" "standard")
    url=$(get_env "PUBLIC_URL" "?")
    admin_email=$(get_env "ADMIN_EMAIL" "?")

    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════╗"
    echo   "║             AgnusAI — Setup Summary                 ║"
    echo   "╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${GREEN}URL:${NC}          $url"
    echo -e "  ${GREEN}Admin:${NC}        $admin_email"
    echo -e "  ${GREEN}LLM:${NC}          $provider / $model"
    echo -e "  ${GREEN}Embeddings:${NC}   ${embedding:-none}"
    echo -e "  ${GREEN}Review depth:${NC} $depth"
    if [[ "$USE_OLLAMA_DOCKER" == "true" ]]; then
        echo -e "  ${GREEN}Ollama:${NC}       Docker container (docker-compose.override.yml)"
    fi
    echo ""

    # Warn about missing required keys
    local has_warning=false
    case "$provider" in
        openai)
            [[ -z "$(get_env "OPENAI_API_KEY" "")" ]] && \
                { log_warning "OPENAI_API_KEY is empty — edit .env before starting"; has_warning=true; }
            ;;
        claude)
            [[ -z "$(get_env "ANTHROPIC_API_KEY" "")" ]] && \
                { log_warning "ANTHROPIC_API_KEY is empty — edit .env before starting"; has_warning=true; }
            ;;
        azure)
            [[ -z "$(get_env "AZURE_OPENAI_API_KEY" "")" ]] && \
                { log_warning "AZURE_OPENAI_API_KEY is empty — edit .env before starting"; has_warning=true; }
            ;;
        custom)
            [[ -z "$(get_env "CUSTOM_LLM_URL" "")" ]] && \
                { log_warning "CUSTOM_LLM_URL is empty — edit .env before starting"; has_warning=true; }
            ;;
    esac


    [[ "$has_warning" == "true" ]] && echo ""
    echo -e "  ${CYAN}Next:${NC} Open $url — log in, then connect your repos via the dashboard."
    echo -e "         Each repo takes its own GitHub/Azure DevOps token at connection time."
    echo -e "  ${CYAN}Tip:${NC}  Edit .env at any time to update keys without re-running this script."
    echo ""

    ask "Start AgnusAI now? (docker compose up --build) (Y/n): " "y"
    if [[ "$REPLY_VALUE" =~ ^[Nn]$ ]]; then
        echo ""
        log_info "When ready, run:  docker compose up --build"
        exit 0
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗"
    echo   "║   AgnusAI — Self-Hosted Graph-Aware AI Code Reviewer    ║"
    echo   "║   https://github.com/ivoyant-eng/AgnusAi               ║"
    echo   "╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    check_root
    check_os
    check_docker
    check_docker_compose
    create_env_file
    prompt_public_url
    prompt_admin
    prompt_llm_provider
    prompt_embedding_provider

    # Configure Ollama only if at least one provider uses it
    local llm_prov emb_prov
    llm_prov=$(get_env "LLM_PROVIDER" "")
    emb_prov=$(get_env "EMBEDDING_PROVIDER" "")
    if [[ "$llm_prov" == "ollama" || "$emb_prov" == "ollama" ]]; then
        prompt_ollama_setup
    fi

    show_summary

    echo ""
    log_info "Launching AgnusAI..."
    echo ""

    local compose_cmd
    if docker compose version &>/dev/null; then
        compose_cmd="docker compose"
    else
        compose_cmd="docker-compose"
    fi

    $compose_cmd up --build
}

main "$@"
