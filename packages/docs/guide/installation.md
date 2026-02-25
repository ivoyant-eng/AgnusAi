# Installation

AgnusAI can be installed in two ways:

## Option 1: One-Command Installer (Recommended)

The easiest way to get started is using our one-command installer script. It will:

1. Check and install Docker if missing
2. Check and install Docker Compose if missing
3. Create a `.env` file with **auto-generated secrets** (WEBHOOK_SECRET, SESSION_SECRET, JWT_SECRET)
4. Set your PUBLIC_URL (auto-detects your server IP)
5. Configure your admin account
6. Walk you through LLM provider selection (Ollama, OpenAI, Claude, Azure, or custom endpoint) and prompt for API keys inline
7. Optionally configure embeddings for deep review mode
8. Offer to run Ollama in Docker (with GPU support) or on your host — or skip it entirely if you use a cloud provider
9. Configure your GitHub token
10. Start the services

```bash
curl -sSL https://raw.githubusercontent.com/ivoyant-eng/AgnusAi/main/install.sh | bash
```

Or download and run locally:

```bash
# Download the installer
curl -sSL https://raw.githubusercontent.com/ivoyant-eng/AgnusAi/main/install.sh -o install.sh

# Make it executable
chmod +x install.sh

# Run it
./install.sh
```

## Option 2: Manual Installation

If you prefer more control over the setup:

### Prerequisites

- Docker (24.0+)
- Docker Compose (2.0+)
- 8GB+ RAM recommended

### Steps

1. **Clone the repository**

   ```bash
   git clone https://github.com/ivoyant-eng/AgnusAi.git
   cd AgnusAi
   ```

2. **Create environment file**

   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

   Required settings — generate random values for secrets:
   ```bash
   WEBHOOK_SECRET=$(openssl rand -hex 32)
   SESSION_SECRET=$(openssl rand -hex 32)
   JWT_SECRET=$(openssl rand -hex 32)
   PUBLIC_URL=http://your-server-ip:3000   # or https://agnus.example.com
   ```

3. **Start services**

   ```bash
   docker compose up --build
   ```

That's it. AgnusAI will start on port 3000.

---

## Configuration

After installation, you'll need to:

1. **Pull LLM models** (only if using Ollama):

   If you chose Ollama running on your **host**:
   ```bash
   ollama pull qwen3.5:397b-cloud
   ollama pull qwen3-embedding:0.6b   # only if using Ollama for embeddings
   ```

   If you chose Ollama running in **Docker** (via `docker-compose.override.yml`):
   ```bash
   docker compose exec ollama ollama pull qwen3.5:397b-cloud
   docker compose exec ollama ollama pull qwen3-embedding:0.6b
   ```

   If you chose a cloud provider (OpenAI, Claude, Azure) — skip this step entirely.

2. **Connect your repositories** via the dashboard at `http://localhost:3000/app/`

   Click **Connect Repo**, enter the repo URL, your VCS token (GitHub PAT or Azure DevOps PAT), and the branches to index. Tokens are stored per-repo — no need to set them in `.env`.

---

## Traefik Gateway

AgnusAI uses Traefik as a reverse proxy/gateway:

| Service | URL | Description |
|---------|-----|-------------|
| Main API | `/` | The main API server |
| Dashboard | `/dashboard` | React SPA for repo management |
| Docs | `/docs` | Documentation |
| Traefik Dashboard | `:8080` | Gateway metrics (insecure, for debugging) |

## Updating

```bash
git pull
docker compose up --build
```

Schema migrations run automatically on startup.

## Uninstall

```bash
# Stop services
docker compose down

# Remove volumes (deletes all data)
docker compose down -v
```

---

## Troubleshooting

### Docker not running
```bash
# Check Docker status
docker info

# Restart Docker service
sudo systemctl restart docker  # Linux
```

### Port already in use
Edit `.env` and change the ports:
```bash
# docker-compose.yml ports section
ports:
  - "8080:80"   # Change 8080 to another port
  - "8443:443"  # Change 8443 to another port
```

### Permission denied on volumes
```bash
# Fix permissions
sudo chown -R $USER:$USER repos-data postgres-data
```
