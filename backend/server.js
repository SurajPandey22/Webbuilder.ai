import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { exec } from "child_process";
import { promisify } from "util";
import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const platform = os.platform();
const asyncExecute = promisify(exec);

async function getProjectFiles(projectPath) {
  if (!fs.existsSync(projectPath)) return [];
  const files = [];
  const items = await fs.promises.readdir(projectPath, { recursive: true });
  for (const item of items) {
    const fullPath = path.join(projectPath, item);
    if (fs.lstatSync(fullPath).isFile()) {
      files.push(item);
    }
  }
  return files;
}

const app = express();
app.use(cors());
app.use('/preview', express.static(path.join(process.cwd(), 'projects')));
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const genAI = new GoogleGenerativeAI("AIzaSyA9FevdzWLt8IQED6ab9d6lml-iWRfnI1I");

async function executeCommand(command) {
  try {
    const execOptions = platform === 'win32' ? { shell: 'powershell.exe' } : {};
    const { stdout, stderr } = await asyncExecute(command, execOptions);
    if (stderr) return `Error: ${stderr}`;
    return `Success: ${stdout} || Task executed completely`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

const executeCommandDeclaration = {
  name: "executeCommand",
  description: "Execute a single terminal/shell command. A command can be to create a folder, file, write on a file, edit the file or delete the file",
  parameters: {
    type: 'OBJECT',
    properties: {
      command: {
        type: 'STRING',
        description: 'It will be a single terminal command. Ex: "mkdir calculator"'
      },
    },
    required: ['command']
  }
};

io.on('connection', (socket) => {
  console.log('Client connected');
  const chatHistory = [];
  const projectName = `project_${Date.now().toString().slice(-6)}`;
  const projectPath = path.join(process.cwd(), 'projects', projectName);

  socket.on('chat-message', async (message) => {
    console.log(`Received message: ${message}`);
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
    socket.emit('project-ready', projectName);

    chatHistory.push({ role: 'user', parts: [{ text: message }] });

    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: `You are an expert AI agent specializing in automated frontend web development.
            Your user's operating system is: ${platform}
            Current working directory: ${process.cwd()}
            IMPORTANT: Create all files inside the directory: "projects/${projectName}".
            Workflow: 1. PLAN -> 2. EXECUTE -> 3. VALIDATE -> 4. REPEAT
            Rules for Writing Files:
            - Windows (win32): Use PowerShell: @"\nYOUR_CODE_HERE\n"@ | Set-Content -Path "projects\\${projectName}\\filename" (Note: @ and " must be together)
            - Linux/macOS: Use 'cat << 'EOF' > projects/${projectName}/filename'
            Final response: Summarize what you did.`
      });

      const chat = model.startChat({
        history: chatHistory.slice(0, -1),
        tools: [{ functionDeclarations: [executeCommandDeclaration] }],
      });

      while (true) {
        const result = await chat.sendMessage(message);
        const response = result.response;
        const calls = response.functionCalls();

        if (calls && calls.length > 0) {
          const call = calls[0];
          console.log(`AI Tool Call: ${call.args.command}`);
          socket.emit('ai-status', { type: 'tool-call', command: call.args.command });

          const toolResult = await executeCommand(call.args.command);
          console.log(`Tool Result: ${toolResult}`);
          socket.emit('ai-status', { type: 'tool-result', result: toolResult });

          // Real-time code stream - Improved extraction
          try {
            const cmd = call.args.command;
            const pathRegex = /(?:projects[/\\]project_\d+[/\\][a-zA-Z0-9._\-\\]+)|(?:-Path\s+["']([^"']+)["'])|(?:>\s*["']?([^"'\s>]+)["']?)/g;
            let match;
            while ((match = pathRegex.exec(cmd)) !== null) {
              const rawPath = (match[1] || match[2] || match[0]).replace(/['">]/g, '').trim();
              const fullPath = path.resolve(process.cwd(), rawPath);
              if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
                const content = await fs.promises.readFile(fullPath, 'utf-8');
                socket.emit('code-update', { path: rawPath, content });
              }
            }
            // Emit updated file list
            const projectFiles = await getProjectFiles(projectPath);
            socket.emit('project-files', projectFiles);
          } catch (e) { console.log(`Code stream error: ${e.message}`); }

          // Send tool result back to AI
          const toolResponse = await chat.sendMessage([{ functionResponse: { name: call.name, response: { result: toolResult } } }]);
          // The loop continues to see if the AI wants more tools or to respond with text
          message = ""; // Reset message for next iteration in same turn
        } else {
          const text = response.text();
          console.log(`AI Message: ${text}`);
          socket.emit('ai-message', text);
          chatHistory.push({ role: 'model', parts: [{ text: text }] });
          break;
        }
      }
    } catch (error) {
      console.error(error);
      socket.emit('error', error.message);
    }
  });

  socket.on('get-file-content', async (filePath) => {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        socket.emit('code-update', { path: filePath, content });
      }
    } catch (e) {
      console.error(e);
    }
  });
});

const PORT = 5000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
