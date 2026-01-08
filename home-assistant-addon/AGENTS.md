# Home Assistant Addon

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (NX commands, commit standards, 1Password, etc.)

## Overview
Home Assistant addon for seamlessly hosting the Jarvis MCP server within your Home Assistant instance.

## Key Features
- **Native Home Assistant Integration**: Runs as a standard addon
- **MCP Server Hosting**: Hosts the Jarvis MCP server
- **Persistent Storage**: All Mastra data in `/data` (included in HA backups)
- **Multi-architecture Support**: AMD64, ARMv7, and AArch64

## NX Commands
```bash
bunx nx serve home-assistant-addon    # Start locally
bunx nx build home-assistant-addon    # Build the addon
bunx nx deploy home-assistant-addon   # Deploy to registry
bunx nx docker:build home-assistant-addon  # Docker build
bunx nx lint home-assistant-addon     # Lint the project
bunx nx test home-assistant-addon     # Run tests
```

## Configuration Management

### config.json Schema
The addon configuration follows Home Assistant's schema. Key fields:
- `google_api_key` → `HEY_JARVIS_GOOGLE_API_KEY` (**REQUIRED**)
- Other API keys are optional

### Image Field Usage
- **Development**: Remove `image` field (builds locally)
- **Production**: Use `"image": "ghcr.io/ffmathy/home-assistant-addon"`

### Build Dependencies
The addon depends on `mcp` project - builds are handled via NX dependency graph.

## Deployment Pipeline

### GitHub Actions Workflow
The addon is deployed via `.github/workflows/release.yml`:

1. **Release Created**: Release Please creates version tags
2. **Deploy Job Runs**: Only when `home-assistant-addon-v*` tag is created
3. **Build in DevContainer**: Uses devcontainer for consistent environment
4. **Deploy Script**: Runs `scripts/deploy.sh` to push Docker images

### Deploy Script Workflow
The `scripts/deploy.sh` script:

1. **Authenticate**: Login to GHCR using `GITHUB_TOKEN`
2. **Get Version**: Extract version from `config.json`
3. **Tag Images**: Create image tag matching the version
   - `{version}` - Matches config.json version (e.g., `0.2.2`)
   - `latest` - Latest version (on main branch)
4. **Push Images**: Push all tags to `ghcr.io/ffmathy/home-assistant-addon`

**Important**: Image tags match the `version` field in `config.json` **without** any 'v' prefix.

**Environment Variables Required**:
- `GITHUB_TOKEN` - GitHub authentication token
- `GITHUB_ACTOR` - GitHub username
- `IMAGE_OWNER` - Docker image owner (default: ffmathy)
- `IMAGE_TAG` - Docker image tag/version (default: latest)

## Home Assistant Integration

### Addon Store Installation

**Manual Repository Addition**:
1. Go to **Supervisor** → **Add-on Store**
2. Click **⋮** → **Repositories**
3. Add: `https://github.com/ffmathy/hey-jarvis`
4. Find "Hey Jarvis MCP Server" in local addons
5. Click **Install**

### Ingress Configuration
The addon uses Home Assistant ingress for secure web access:
- **Ingress Enabled**: `"ingress": true`
- **Ingress Port**: `4113`
- **Panel Icon**: `mdi:robot`
- **Web UI**: Accessible via Home Assistant interface

### API Access
The addon has Home Assistant API access:
- `"hassio_api": true` - Access to Supervisor API
- `"homeassistant_api": true` - Access to Home Assistant Core API
- `"hassio_role": "default"` - Default role permissions

### Permissions
- `"privileged": ["NET_ADMIN"]` - Network administration for MCP server
- `"apparmor": true` - AppArmor security enabled
- `"full_access": false` - Limited access (security best practice)

### Persistent Storage and Backups
The addon automatically stores all Mastra data in the `/data` directory, which is:
- **Automatically backed up** by Home Assistant's backup system
- **Persistent across restarts** and addon updates
- **Includes all databases**:
  - `mastra.sql.db` - Agent memory, credentials, and configuration
  - `mastra.vector.db` - Vector embeddings for semantic search
  
**What gets backed up:**
- All agent conversation history and memory
- OAuth refresh tokens (Google, Microsoft)
- Vector embeddings for semantic recall
- Custom configuration and state

**Backup verification:**
When the addon starts, you'll see a log message indicating which directory is being used:
```
📦 Using Home Assistant data directory for storage (backed up automatically): /data
```

**Restoring from backup:**
Simply restore your Home Assistant backup, and all Mastra data will be restored automatically. No manual steps required.

## Architecture

### Component Flow
```
ElevenLabs Agent → Home Assistant Addon → MCP Server → Home Assistant Devices
                                ↓
                          Docker Container
                                ↓
                    ghcr.io/ffmathy/mcp (base image)
                                ↓
                   Nginx (4111, 4113) → Mastra Studio (8113)
                                ↓
                          Mastra Server (8111)
```

### Base Image Relationship
The addon uses `ghcr.io/ffmathy/mcp` as its base image:
- **Dockerfile**: `FROM ghcr.io/ffmathy/mcp:latest`
- **Dependency**: Built automatically via NX dependency graph
- **Updates**: Addon version should match mcp version

## Troubleshooting

### Common Issues

**1. Docker Image Not Found (404)**
```
Can't install ghcr.io/ffmathy/home-assistant-addon:0.2.2: 
404 Client Error: Not Found ("manifest unknown")
```

**Cause**: Image tag mismatch - the image tag doesn't match the version in `config.json`.

**Solution**:
1. Verify the deploy script creates tags matching `config.json` version (without 'v' prefix)
2. Check GHCR has the `0.2.2` tag using GitHub MCP tools
3. For existing releases with wrong tags, manually retag:
   ```bash
   docker pull ghcr.io/ffmathy/home-assistant-addon:v0.2.2
   docker tag ghcr.io/ffmathy/home-assistant-addon:v0.2.2 ghcr.io/ffmathy/home-assistant-addon:0.2.2
   docker push ghcr.io/ffmathy/home-assistant-addon:0.2.2
   ```

**2. Wrong Architecture**
```
Can't install: platform linux/arm64 not available
```

**Solution**:
- Update `scripts/deploy.sh` to use `docker buildx` for multi-arch builds
- Or remove `image` field to build locally for current architecture

**3. Build Dependencies Failed**
```
Error: mcp:docker:build failed
```

**Solution**:
```bash
# Build dependencies first
nx build mcp

# Then build addon
nx build home-assistant-addon
```

### Debug Commands

```bash
# Check if Docker image exists in GHCR
docker manifest inspect ghcr.io/ffmathy/home-assistant-addon:v0.2.2

# View build logs
nx build home-assistant-addon --verbose

# Check deployment script
cat home-assistant-addon/scripts/deploy.sh

# View GitHub Actions logs via GitHub MCP tools
# (Check the release workflow for deployment status)
```

## Development Guidelines

### Addon-Specific YAGNI Guidelines
Apply YAGNI to addon development:
- **Configuration Options**: Only add options users actually need
- **Build Scripts**: Keep simple - no "local mode" flags or optional behaviors
- **Features**: Keep addon focused on core MCP server hosting

### Version Synchronization

**Important**: The addon version in `config.json` should align with releases:
- Addon version: `0.2.2`
- Release tag: `home-assistant-addon-v0.2.2`
- Docker image: `ghcr.io/ffmathy/home-assistant-addon:v0.2.2`

**Version bumping is handled by Release Please**:
- Automated version updates in `config.json`
- Creates release tags automatically
- Triggers deployment pipeline

### Testing Workflow

1. **Local Development**:
   ```bash
   # Build without pushing
   nx build home-assistant-addon
   
   # Test locally (builds and serves)
   nx serve home-assistant-addon
   ```

2. **Test Installation**:
   - Remove `image` field from `config.json`
   - Add addon directory to Home Assistant
   - Install addon to build locally

3. **Verify Multi-Arch** (when implemented):
   - Check Docker manifest: `docker manifest inspect <image>`
   - Verify all architectures are present

## Future Enhancements

- **Multi-architecture image building** with Docker buildx
- **Automated testing** of addon installation
- **Configuration options** for advanced users (following YAGNI)
- **Health monitoring** and status reporting
- **Integration tests** with Home Assistant

## Contributing
- Follow Home Assistant addon best practices
- Use NX commands exclusively
- Test on actual Home Assistant installation before release
- Update this AGENTS.md file with any changes
- Verify Docker images are pushed before releasing

### Scope Guidelines for Commits
Use addon-specific scopes:
- `addon`, `config`, `docker`
- `deployment`, `ingress`
