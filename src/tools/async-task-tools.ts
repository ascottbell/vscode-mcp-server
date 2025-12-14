import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from 'crypto';

// Task status types
type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface Task {
    id: string;
    command: string;
    cwd?: string;
    status: TaskStatus;
    output: string;
    error?: string;
    startedAt: Date;
    completedAt?: Date;
    terminal?: vscode.Terminal;
}

// In-memory task store
const tasks: Map<string, Task> = new Map();

/**
 * Waits briefly for shell integration to become available
 */
async function waitForShellIntegration(terminal: vscode.Terminal, timeout = 2000): Promise<boolean> {
    if (terminal.shellIntegration) {
        return true;
    }

    return new Promise<boolean>(resolve => {
        const timeoutId = setTimeout(() => {
            disposable.dispose();
            resolve(false);
        }, timeout);

        const disposable = vscode.window.onDidChangeTerminalShellIntegration(e => {
            if (e.terminal === terminal && terminal.shellIntegration) {
                clearTimeout(timeoutId);
                disposable.dispose();
                resolve(true);
            }
        });
    });
}

/**
 * Executes a command asynchronously, updating the task as it progresses
 */
async function executeTaskAsync(task: Task, terminal: vscode.Terminal): Promise<void> {
    try {
        terminal.show();
        
        // Build full command
        let fullCommand = task.command;
        if (task.cwd && task.cwd !== '.' && task.cwd !== './') {
            const quotedPath = task.cwd.includes(' ') ? `"${task.cwd}"` : task.cwd;
            fullCommand = `cd ${quotedPath} && ${task.command}`;
        }
        
        // Wait for shell integration
        if (!terminal.shellIntegration) {
            const available = await waitForShellIntegration(terminal);
            if (!available) {
                task.status = 'failed';
                task.error = 'Shell integration not available';
                task.completedAt = new Date();
                return;
            }
        }
        
        // Execute the command
        const execution = terminal.shellIntegration!.executeCommand(fullCommand);
        
        // Capture output
        try {
            const outputStream = (execution as any).read();
            for await (const data of outputStream) {
                if (task.status === 'cancelled') {
                    break;
                }
                task.output += data;
            }
            
            if (task.status !== 'cancelled') {
                task.status = 'completed';
            }
        } catch (error) {
            task.status = 'failed';
            task.error = `Failed to read output: ${error}`;
        }
        
        task.completedAt = new Date();
    } catch (error) {
        task.status = 'failed';
        task.error = String(error);
        task.completedAt = new Date();
    }
}

/**
 * Registers async task tools with the MCP server
 */
export function registerAsyncTaskTools(server: McpServer, getTerminal: () => vscode.Terminal | undefined): void {
    
    // run_task_async - starts a command and returns immediately
    server.tool(
        'run_task_async',
        `Starts a shell command in the background and returns immediately with a task ID.
        
        Use this for long-running commands (builds, tests, installs, etc.) that would otherwise timeout.
        Poll the task status with get_task_status using the returned task ID.
        
        Returns: { taskId: string, status: 'running' }`,
        {
            command: z.string().describe('The shell command to execute'),
            cwd: z.string().optional().default('.').describe('Working directory for the command')
        },
        async ({ command, cwd }): Promise<CallToolResult> => {
            const terminal = getTerminal();
            if (!terminal) {
                throw new Error('Terminal not available');
            }
            
            const taskId = randomUUID().slice(0, 8);
            const task: Task = {
                id: taskId,
                command,
                cwd,
                status: 'running',
                output: '',
                startedAt: new Date(),
                terminal
            };
            
            tasks.set(taskId, task);
            
            // Fire and forget - don't await
            executeTaskAsync(task, terminal).catch(err => {
                task.status = 'failed';
                task.error = String(err);
                task.completedAt = new Date();
            });
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        taskId,
                        status: 'running',
                        command,
                        startedAt: task.startedAt.toISOString()
                    }, null, 2)
                }]
            };
        }
    );
    
    // get_task_status - check on a running task
    server.tool(
        'get_task_status',
        `Gets the current status and output of an async task.
        
        Returns status (running/completed/failed/cancelled), output so far, and timing info.
        Use this to poll for completion of tasks started with run_task_async.`,
        {
            taskId: z.string().describe('The task ID returned by run_task_async')
        },
        async ({ taskId }): Promise<CallToolResult> => {
            const task = tasks.get(taskId);
            
            if (!task) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ error: 'Task not found', taskId }, null, 2)
                    }]
                };
            }
            
            const result: any = {
                taskId: task.id,
                command: task.command,
                status: task.status,
                output: task.output,
                startedAt: task.startedAt.toISOString()
            };
            
            if (task.completedAt) {
                result.completedAt = task.completedAt.toISOString();
                result.durationMs = task.completedAt.getTime() - task.startedAt.getTime();
            }
            
            if (task.error) {
                result.error = task.error;
            }
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };
        }
    );
    
    // list_tasks - show all tasks
    server.tool(
        'list_tasks',
        `Lists all async tasks (running and completed).
        
        Useful for seeing what's currently running and recent task history.`,
        {
            status: z.enum(['all', 'running', 'completed', 'failed']).optional().default('all')
                .describe('Filter by status')
        },
        async ({ status }): Promise<CallToolResult> => {
            let taskList = Array.from(tasks.values());
            
            if (status !== 'all') {
                taskList = taskList.filter(t => t.status === status);
            }
            
            const summary = taskList.map(t => ({
                taskId: t.id,
                command: t.command.slice(0, 50) + (t.command.length > 50 ? '...' : ''),
                status: t.status,
                startedAt: t.startedAt.toISOString(),
                completedAt: t.completedAt?.toISOString()
            }));
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        count: summary.length,
                        tasks: summary
                    }, null, 2)
                }]
            };
        }
    );
    
    // cancel_task - kill a running task
    server.tool(
        'cancel_task',
        `Cancels a running async task.
        
        Note: This marks the task as cancelled but may not immediately stop the underlying process.`,
        {
            taskId: z.string().describe('The task ID to cancel')
        },
        async ({ taskId }): Promise<CallToolResult> => {
            const task = tasks.get(taskId);
            
            if (!task) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ error: 'Task not found', taskId }, null, 2)
                    }]
                };
            }
            
            if (task.status !== 'running') {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ 
                            error: 'Task is not running', 
                            taskId, 
                            status: task.status 
                        }, null, 2)
                    }]
                };
            }
            
            task.status = 'cancelled';
            task.completedAt = new Date();
            
            // Try to send Ctrl+C to terminal
            if (task.terminal) {
                task.terminal.sendText('\x03', false); // Ctrl+C
            }
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        taskId,
                        status: 'cancelled',
                        message: 'Task cancellation requested'
                    }, null, 2)
                }]
            };
        }
    );
}
