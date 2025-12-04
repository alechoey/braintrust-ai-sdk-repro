import "dotenv/config";
import * as ai from "ai";
import { wrapAISDK } from "braintrust";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import blessed from "blessed";

// Select model based on available API keys
let baseModel;
let modelName;

if (process.env.ANTHROPIC_API_KEY) {
  const anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  baseModel = anthropic("claude-3-5-haiku-latest");
  modelName = "Claude 3.5 Haiku";
} else if (process.env.OPENAI_API_KEY) {
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  baseModel = openai("gpt-4o-mini");
  modelName = "GPT-4o Mini";
} else {
  console.error("Error: Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set.");
  console.error("Please set one of them in your .env file.");
  process.exit(1);
}

// Wrap the AI SDK functions instead of the model
const { streamText: wrappedStreamText } = wrapAISDK(ai);

// Define tool with inputSchema (AI SDK 5 format)
const createGreetingTool = (logFn) => ({
  description: "A tool that streams a greeting message",
  inputSchema: ai.jsonSchema({
    type: "object",
    properties: {
      name: { type: "string", description: "The name to greet" },
    },
    required: ["name"],
  }),
  execute: async function* ({ name }) {
    logFn(`[execute] Starting generator for: ${name}`);
    yield { status: "starting", message: "Preparing greeting..." };
    logFn("[execute] Yielded starting status");
    yield { status: "processing", message: `Looking up ${name}...` };
    logFn("[execute] Yielded processing status");
    yield { status: "generating", message: "Generating greeting..." };
    logFn("[execute] Yielded generating status");
    const greeting = `Hello, ${name}!`;
    logFn("[execute] Returning final result");
    const result = { status: "done", greeting };
    yield result;
  },
});

// Create TUI
const screen = blessed.screen({
  smartCSR: true,
  title: `Braintrust Async Generator Repro - ${modelName}`,
});

// Left panel - Without wrapping
const leftBox = blessed.box({
  top: 0,
  left: 0,
  width: "50%",
  height: "100%-1",
  border: { type: "line" },
  label: " WITHOUT Braintrust (ai.streamText) ",
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: "█", bg: "blue" },
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
});

// Right panel - With wrapping
const rightBox = blessed.box({
  top: 0,
  left: "50%",
  width: "50%",
  height: "100%-1",
  border: { type: "line" },
  label: " WITH Braintrust (wrappedStreamText) ",
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: "█", bg: "green" },
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
});

// Status bar
const statusBar = blessed.box({
  bottom: 0,
  left: 0,
  width: "100%",
  height: 1,
  content: ` {bold}Model:{/bold} ${modelName} | {bold}↑/↓{/bold} scroll | {bold}q{/bold} quit | {bold}Tab{/bold} switch panel`,
  tags: true,
  style: { bg: "blue", fg: "white" },
});

screen.append(leftBox);
screen.append(rightBox);
screen.append(statusBar);

// Sync scrolling
let syncing = false;

function syncScroll(source, target) {
  if (syncing) return;
  syncing = true;
  const scrollPercent = source.getScrollPerc();
  target.setScrollPerc(scrollPercent);
  screen.render();
  syncing = false;
}

leftBox.on("scroll", () => syncScroll(leftBox, rightBox));
rightBox.on("scroll", () => syncScroll(rightBox, leftBox));

// Focus management
let focusedBox = leftBox;
leftBox.focus();

screen.key(["tab"], () => {
  if (focusedBox === leftBox) {
    focusedBox = rightBox;
    rightBox.focus();
  } else {
    focusedBox = leftBox;
    leftBox.focus();
  }
  screen.render();
});

// Global scroll keys
screen.key(["up", "k"], () => {
  leftBox.scroll(-1);
  syncScroll(leftBox, rightBox);
});

screen.key(["down", "j"], () => {
  leftBox.scroll(1);
  syncScroll(leftBox, rightBox);
});

screen.key(["pageup"], () => {
  leftBox.scroll(-leftBox.height);
  syncScroll(leftBox, rightBox);
});

screen.key(["pagedown"], () => {
  leftBox.scroll(leftBox.height);
  syncScroll(leftBox, rightBox);
});

screen.key(["home", "g"], () => {
  leftBox.setScrollPerc(0);
  syncScroll(leftBox, rightBox);
});

screen.key(["end", "S-g"], () => {
  leftBox.setScrollPerc(100);
  syncScroll(leftBox, rightBox);
});

screen.key(["q", "C-c"], () => process.exit(0));

const leftLines = [];
const rightLines = [];

function logLeft(msg) {
  leftLines.push(msg);
  leftBox.setContent(leftLines.join("\n"));
  leftBox.setScrollPerc(100);
  syncScroll(leftBox, rightBox);
}

function logRight(msg) {
  rightLines.push(msg);
  rightBox.setContent(rightLines.join("\n"));
  rightBox.setScrollPerc(100);
  syncScroll(rightBox, leftBox);
}

function formatPart(part) {
  const clean = JSON.stringify(part, (key, value) => {
    if (key === "error" && value instanceof Error) {
      return { name: value.name, message: value.message };
    }
    return value;
  }, 2);
  return clean;
}

async function testWithoutWrapping() {
  logLeft("{yellow-fg}Starting test (ai.streamText)...{/yellow-fg}\n");

  const result = ai.streamText({
    model: baseModel,
    prompt: "Please use the greeting tool to greet someone named World",
    tools: {
      greeting: createGreetingTool(logLeft),
    },
  });

  for await (const part of result.fullStream) {
    logLeft("{cyan-fg}Part:{/cyan-fg}");
    logLeft(formatPart(part));
    logLeft("");
  }

  const finalText = await result.text;
  const toolCalls = await result.toolCalls;
  const toolResults = await result.toolResults;

  logLeft("{yellow-fg}=== Final Text ==={/yellow-fg}");
  logLeft(finalText || "(empty)");
  logLeft("");
  logLeft("{yellow-fg}=== Tool Calls ==={/yellow-fg}");
  logLeft(formatPart(toolCalls));
  logLeft("");
  logLeft("{yellow-fg}=== Tool Results ==={/yellow-fg}");
  logLeft(formatPart(toolResults));
  logLeft("");
  logLeft("{green-fg}Done!{/green-fg}");
}

async function testWithWrapping() {
  logRight("{yellow-fg}Starting test (wrappedStreamText)...{/yellow-fg}\n");

  const result = wrappedStreamText({
    model: baseModel,
    prompt: "Please use the greeting tool to greet someone named World",
    tools: {
      greeting: createGreetingTool(logRight),
    },
  });

  for await (const part of result.fullStream) {
    logRight("{cyan-fg}Part:{/cyan-fg}");
    logRight(formatPart(part));
    logRight("");
  }

  const toolResults = await result.toolResults;

  logRight("{yellow-fg}=== Tool Results ==={/yellow-fg}");
  logRight(formatPart(toolResults));
  logRight("");
  logRight("{green-fg}Done!{/green-fg}");
}

screen.render();

// Run both tests in parallel
Promise.all([
  testWithoutWrapping().catch((e) => {
    logLeft(`{red-fg}Error: ${e.message}{/red-fg}`);
    if (e.cause) logLeft(`Cause: ${JSON.stringify(e.cause, null, 2)}`);
  }),
  testWithWrapping().catch((e) => {
    logRight(`{red-fg}Error: ${e.message}{/red-fg}`);
    if (e.cause) logRight(`Cause: ${JSON.stringify(e.cause, null, 2)}`);
  }),
]).then(() => {
  logLeft("\n{bold}Press q to quit{/bold}");
  logRight("\n{bold}Press q to quit{/bold}");
});
