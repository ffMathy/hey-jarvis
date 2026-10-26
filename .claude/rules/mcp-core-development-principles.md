---
paths:
  - "mcp/**"
---

# Core Development Principles

> Part of [Jarvis Mastra AI Agents → Development Guidelines](mcp-development-guidelines.md). Paths in it are relative to `mcp/` unless they say otherwise.

## 🔌 **Port Configuration Management**
**CRITICAL: When changing ports, ALWAYS update ALL of these files:**

1. **Service Configuration**:
   - `mcp/supervisord.conf` - Production service ports

2. **Port Constants**:
   - `mcp/lib/ports.sh` - Bash port constants (centralized)

3. **Documentation**:
   - `.claude/rules/mcp.md` - Update port references in documentation

**Port Change Checklist**:
- [ ] Update supervisord.conf
- [ ] Update ports.sh
- [ ] Update this rule (`.claude/rules/mcp.md`)
