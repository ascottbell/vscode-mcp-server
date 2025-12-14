# VS Code MCP Server (Async Fork)

A VS Code extension that exposes your IDE as an MCP server, allowing Claude and other AI assistants to control VS Code directly. **This fork adds async task execution** - run long-running commands without blocking your conversation.

## The Problem This Solves

When using Claude Desktop with VS Code MCP tools, long-running commands (builds, tests, installs) timeout after 10 seconds, blocking your conversation until they complete.

**This fork adds async task execution:**
- Start a command → get a job ID immediately → keep chatting
- Check status whenever you want
- No more blocked conversations waiting for builds

## New Async Tools

| Tool | Description |
|------|-------------|
| `run_task_async` | Starts a command in background, returns job ID immediately |
| `get_task_status` | Check status/output of a running or completed task |
| `list_tasks` | Show all tasks (running, completed, failed) |
| `cancel_task` | Cancel a running task |

### Example Workflow

```
You: Run npm install and npm run build

Claude: [calls run_task_async with "npm install && npm run build"]
        Started task abc123. I'll check on it in a moment.
        
        In the meantime, what else would you like to work on?

You: Let's review the README while that runs

Claude: [reads README, discusses it with you]
        
        Let me check on that build...
        [calls get_task_status with "abc123"]
        
        Build completed successfully! Here's the output...
```

## Installation

### Option 1: Build from source (recommended for now)

```bash
git clone https://github.com/ascottbell/vscode-mcp-server
cd vscode-mcp-server
npm install
npm run compile
```

Then in VS Code: Extensions → "..." menu → "Install from VSIX" → select the built `.vsix` file

Or press F5 in VS Code to run in development mode.

### Option 2: Use with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vscode": {
      "command": "npx",
      "args": ["mcp-remote@next", "http://localhost:3000/mcp"]
    }
  }
}
```

Then enable the MCP server in VS Code (click status bar item).

## All Available Tools

### File Tools
- `list_files_code` - List files and directories
- `read_file_code` - Read file contents

### Edit Tools  
- `create_file_code` - Create new files
- `replace_lines_code` - Edit specific lines in files

### Shell Tools
- `execute_shell_command_code` - Run commands (sync, 10s timeout)

### Async Task Tools (NEW)
- `run_task_async` - Start command in background
- `get_task_status` - Check task status/output
- `list_tasks` - List all tasks
- `cancel_task` - Cancel running task

### Diagnostics Tools
- `get_diagnostics_code` - Get errors/warnings from VS Code

### Symbol Tools
- `search_symbols_code` - Search for symbols across workspace
- `get_symbol_definition_code` - Get symbol definition info
- `get_document_symbols_code` - Get file outline/structure

## Configuration

In VS Code settings, you can enable/disable specific tool categories:

```json
{
  "vscode-mcp-server.enabledTools": {
    "file": true,
    "edit": true,
    "shell": true,
    "asyncTask": true,
    "diagnostics": true,
    "symbol": true
  }
}
```

## Why This Fork?

The original [juehang/vscode-mcp-server](https://github.com/juehang/vscode-mcp-server) is excellent but lacks async execution. This fork adds the ability to run long-running tasks without blocking, which is essential for real development workflows.

The goal: **Your AI is the center, the IDE is just a surface.**

## License

MIT - Same as the original project.

## Credits

Based on [juehang/vscode-mcp-server](https://github.com/juehang/vscode-mcp-server) by Juehang Qin.
