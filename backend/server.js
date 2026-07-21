import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { exec } from "child_process";
import { promisify } from "util";
import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const platform = os.platform();
const asyncExecute = promisify(exec);

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("❌ ERROR: GEMINI_API_KEY is not set in .env file!");
  process.exit(1);
}
console.log(`✅ API Key loaded: ${API_KEY.slice(0, 12)}...`);

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Universal Gemini API call using fetch — supports both AIzaSy and AQ. keys with auto-retry on 429 rate limit
async function callGemini(contents, systemInstruction, tools, attempt = 1) {
  const headers = { "Content-Type": "application/json" };
  const url = `${BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;

  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    tools: tools ? [{ functionDeclarations: tools }] : undefined,
    generationConfig: { temperature: 0.7 }
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429 && attempt <= 5) {
      let delayMs = Math.pow(2, attempt) * 2000 + Math.random() * 1000;
      try {
        const parsed = JSON.parse(errText);
        const retryInfo = parsed.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
        if (retryInfo && retryInfo.retryDelay) {
          const match = retryInfo.retryDelay.match(/^(\d+(\.\d+)?)s$/);
          if (match) {
            delayMs = parseFloat(match[1]) * 1000 + 1000; // Add 1 second buffer
          }
        }
      } catch (e) {
        // Ignore JSON parsing errors
      }
      console.warn(`⚠️ Rate limited (429). Retrying attempt ${attempt} in ${Math.round(delayMs)}ms...`);
      await sleep(delayMs);
      return callGemini(contents, systemInstruction, tools, attempt + 1);
    }
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }
  return res.json();
}

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
  cors: { origin: "*", methods: ["GET", "POST"] }
});

async function executeCommand(command) {
  try {
    const execOptions = platform === 'win32'
      ? { shell: 'powershell.exe', timeout: 30000 }
      : { timeout: 30000 };
    const { stdout, stderr } = await asyncExecute(command, execOptions);
    if (stderr && !stderr.includes('already exists') && !stderr.includes('DirectoryExist')) {
      return `Error: ${stderr}`;
    }
    return `Success: ${stdout || 'Command executed'} || Task executed completely`;
  } catch (error) {
    if (error.message.includes('already exists') || error.message.includes('DirectoryExist')) {
      return `Success: Directory already exists, skipping || Task executed completely`;
    }
    return `Error: ${error.message}`;
  }
}

const executeCommandDeclaration = {
  name: "executeCommand",
  description: "Execute a terminal/shell command to create folders, files, write/edit files",
  parameters: {
    type: 'OBJECT',
    properties: {
      command: {
        type: 'STRING',
        description: 'Single terminal command e.g. "mkdir calculator"'
      }
    },
    required: ['command']
  }
};

const writeFileDeclaration = {
  name: "writeFile",
  description: "Create a new file or overwrite an existing file inside the project directory.",
  parameters: {
    type: 'OBJECT',
    properties: {
      filePath: {
        type: 'STRING',
        description: 'Relative file path inside the project directory, e.g. "index.html" or "style.css"'
      },
      content: {
        type: 'STRING',
        description: 'Full text content of the file'
      }
    },
    required: ['filePath', 'content']
  }
};

async function writeProjectFile(projectName, filePath, content) {
  try {
    let cleanPath = filePath.replace(/\\/g, '/');
    if (cleanPath.startsWith('projects/')) {
      cleanPath = cleanPath.substring('projects/'.length);
    }
    if (cleanPath.startsWith(`${projectName}/`)) {
      cleanPath = cleanPath.substring(`${projectName}/`.length);
    }
    const projectPath = path.join(process.cwd(), 'projects', projectName);
    const fullPath = path.resolve(projectPath, cleanPath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      await fs.promises.mkdir(parentDir, { recursive: true });
    }
    await fs.promises.writeFile(fullPath, content, 'utf-8');
    return `Success: File written successfully to ${cleanPath}`;
  } catch (error) {
    return `Error: Failed to write file: ${error.message}`;
  }
}

io.on('connection', (socket) => {
  console.log('Client connected');
  const chatHistory = [];
  const projectName = `project_${Date.now().toString().slice(-6)}`;
  const projectPath = path.join(process.cwd(), 'projects', projectName);

  const messageQueue = [];
  let isProcessing = false;

  async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    isProcessing = true;
    const message = messageQueue.shift();

    console.log(`Processing message: ${message}`);
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
    socket.emit('project-ready', projectName);
    chatHistory.push({ role: 'user', parts: [{ text: message }] });

    const systemInstruction = `You are an expert AI agent specializing in automated frontend web development.
      Your user's operating system is: ${platform}
      Current working directory: ${process.cwd()}
      IMPORTANT: Create all files inside the directory: "projects/${projectName}".
      IMPORTANT: Build ONLY static Vanilla HTML, CSS, and JavaScript applications. Do NOT use React, Vue, Vite, or other frameworks/bundlers unless explicitly requested, as the project is served and previewed statically directly via express.static.
      IMPORTANT: Ensure all asset and script paths in index.html (like CSS, JS, images) are RELATIVE (e.g. use "./style.css" or "style.css", NOT "/style.css") so they resolve correctly under the subfolder preview url.
      CRITICAL RULE FOR VAGUE PROMPTS:
      - If the user's prompt is extremely vague, brief, or lacks specific project details (e.g., just saying "give index.html", "index.html", "build a site", "make a page", or similar), do NOT write any files or use any tools.
      - Instead, respond directly with a friendly message asking them what type of application they would like to build, and suggest 3 concrete, interesting frontend project options (such as a Dynamic Interactive Calculator, a Weather Dashboard with charts, or a Gamified Task/Pomodoro Planner) to choose from.
      Rules for Writing Files:
      - ALWAYS prefer using the 'writeFile' tool to create or edit files. This prevents hitting Windows command length limits (spawn ENAMETOOLONG).
      - If you must run a command, use the 'executeCommand' tool. Windows (win32): Use PowerShell. Linux/macOS: Use bash.
      Final response: Summarize what you did.`;

    try {
      while (true) {
        const data = await callGemini(chatHistory, systemInstruction, [executeCommandDeclaration, writeFileDeclaration]);
        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const funcCallPart = parts.find(p => p.functionCall);

        if (funcCallPart) {
          const call = funcCallPart.functionCall;
          let toolResult;

          if (call.name === 'writeFile') {
            console.log(`AI Tool Call: writeFile -> ${call.args.filePath}`);
            socket.emit('ai-status', { type: 'tool-call', command: `Write File: ${call.args.filePath}` });
            toolResult = await writeProjectFile(projectName, call.args.filePath, call.args.content);
          } else {
            console.log(`AI Tool Call: ${call.args.command}`);
            socket.emit('ai-status', { type: 'tool-call', command: call.args.command });
            toolResult = await executeCommand(call.args.command);
          }

          console.log(`Tool Result: ${toolResult}`);
          socket.emit('ai-status', { type: 'tool-result', result: toolResult });

          // Stream file content
          try {
            if (call.name === 'writeFile') {
              let cleanPath = call.args.filePath.replace(/\\/g, '/');
              if (cleanPath.startsWith('projects/')) {
                cleanPath = cleanPath.substring('projects/'.length);
              }
              if (cleanPath.startsWith(`${projectName}/`)) {
                cleanPath = cleanPath.substring(`${projectName}/`.length);
              }
              const rawPath = `projects/${projectName}/${cleanPath}`;
              socket.emit('code-update', { path: rawPath, content: call.args.content });
            } else {
              const cmd = call.args.command;
              const pathRegex = /(?:projects[/\\]project_\d+[/\\][a-zA-Z0-9._\-\\]+)|(?:-Path\s+["']([^"']+)["'])/g;
              let match;
              while ((match = pathRegex.exec(cmd)) !== null) {
                const rawPath = (match[1] || match[0]).replace(/['">]/g, '').trim();
                const fullPath = path.resolve(process.cwd(), rawPath);
                if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
                  const content = await fs.promises.readFile(fullPath, 'utf-8');
                  socket.emit('code-update', { path: rawPath, content });
                }
              }
            }
            const projectFiles = await getProjectFiles(projectPath);
            socket.emit('project-files', projectFiles);
          } catch (e) { console.log(`Code stream error: ${e.message}`); }

          // Add to history and continue
          chatHistory.push({ role: 'model', parts });
          chatHistory.push({
            role: 'user',
            parts: [{ functionResponse: { name: call.name, response: { result: toolResult } } }]
          });
        } else {
          const text = parts.map(p => p.text || '').join('');
          console.log(`AI Message: ${text}`);
          socket.emit('ai-message', text);
          chatHistory.push({ role: 'model', parts: [{ text }] });
          break;
        }
      }
    } catch (error) {
      console.error(error);
      socket.emit('error', error.message);
    } finally {
      isProcessing = false;
      setTimeout(processQueue, 2000);
    }
  }

  socket.on('chat-message', (message) => {
    messageQueue.push(message);
    processQueue();
  });

  socket.on('get-file-content', async (filePath) => {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        socket.emit('code-update', { path: filePath, content });
      }
    } catch (e) { console.error(e); }
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
