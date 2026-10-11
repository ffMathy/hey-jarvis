import type { GetAgentResponseModel } from '@elevenlabs/elevenlabs-js/api';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import * as path from 'path';

/**
 * Where the committed agent lives: the config, the prompt beside it, and in `tools/` a
 * JSON file per tool with its description beside it in Markdown, as the prompt is.
 */
export const ASSETS_PATH = path.join(import.meta.dir, 'assets');

export const CONFIG_FILE = 'agent-config.json';
export const PROMPT_FILE = 'agent-prompt.md';
export const TOOLS_DIRECTORY = 'tools';

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A tool's name doubles as its file name, so it has to be one. */
function toolFileName(name: unknown): string {
  if (typeof name !== 'string' || !/^[\w-]+$/.test(name)) {
    throw new Error(`Tool name "${String(name)}" cannot be used as a file name in ${TOOLS_DIRECTORY}/`);
  }
  return `${name}.json`;
}

/** The Markdown file beside a tool's JSON that holds its description. */
function descriptionFileName(toolFileName: string): string {
  return toolFileName.replace(/\.json$/, '.md');
}

/**
 * Takes every tool out of the agent's two tool lists, leaving its name behind, and
 * returns the tools by file name.
 *
 * A system tool is listed twice — once in `tools` and once under its own key in
 * `builtInTools` — and each copy carries the tool's whole description, which runs to
 * pages for `end_call` and `skip_turn`. Kept inline, a one-word change to either was a
 * single changed line of escaped JSON, made twice. Committed this way, each tool is
 * one file of its own, and both lists name it.
 *
 * `builtInTools` keeps its `null` entries: they are how ElevenLabs reports a built-in
 * tool that is switched off. Two different tools under one name would overwrite each
 * other's file, so that throws instead.
 */
export function splitTools(prompt: JsonObject): { references: JsonObject; toolFiles: Map<string, JsonObject> } {
  const toolFiles = new Map<string, JsonObject>();

  const reference = (tool: unknown): unknown => {
    if (!isJsonObject(tool)) {
      return tool;
    }
    const fileName = toolFileName(tool.name);
    const existing = toolFiles.get(fileName);
    if (existing && JSON.stringify(existing) !== JSON.stringify(tool)) {
      throw new Error(`Two different tools are both named "${tool.name}", and only one of them fits in ${fileName}`);
    }
    toolFiles.set(fileName, tool);
    return tool.name;
  };

  const references: JsonObject = {};
  if (Array.isArray(prompt.tools)) {
    references.tools = prompt.tools.map(reference);
  }
  if (isJsonObject(prompt.builtInTools)) {
    references.builtInTools = Object.fromEntries(
      Object.entries(prompt.builtInTools).map(([key, tool]) => [key, reference(tool)]),
    );
  }

  return { references, toolFiles };
}

/** The inverse of `splitTools`: every name in the two lists replaced by the tool it names. */
export function joinTools(references: JsonObject, toolFiles: ReadonlyMap<string, JsonObject>): JsonObject {
  const resolve = (name: unknown): unknown => {
    if (name === null) {
      return null;
    }
    const fileName = toolFileName(name);
    const tool = toolFiles.get(fileName);
    if (!tool) {
      throw new Error(`The agent config names the tool "${name}", but ${TOOLS_DIRECTORY}/${fileName} does not exist`);
    }
    return tool;
  };

  const lists: JsonObject = {};
  if (Array.isArray(references.tools)) {
    lists.tools = references.tools.map(resolve);
  }
  if (isJsonObject(references.builtInTools)) {
    lists.builtInTools = Object.fromEntries(
      Object.entries(references.builtInTools).map(([key, name]) => [key, resolve(name)]),
    );
  }

  return lists;
}

/** `conversationConfig.agent.prompt`, the object both tool lists live in. */
function promptOf(config: JsonObject): JsonObject | undefined {
  const { conversationConfig } = config;
  if (!isJsonObject(conversationConfig) || !isJsonObject(conversationConfig.agent)) {
    return undefined;
  }
  const { prompt } = conversationConfig.agent;
  return isJsonObject(prompt) ? prompt : undefined;
}

/** Writes the config with its tools split out, removing the file of any tool it no longer has. */
export async function writeAgentConfig(config: object, assetsPath = ASSETS_PATH): Promise<void> {
  const configToWrite: JsonObject = { ...structuredClone(config) };
  const prompt = promptOf(configToWrite);
  const { references, toolFiles } = prompt ? splitTools(prompt) : { references: {}, toolFiles: new Map() };
  if (prompt) {
    Object.assign(prompt, references);
  }

  await writeFile(path.join(assetsPath, CONFIG_FILE), JSON.stringify(configToWrite, null, 2), 'utf-8');

  const toolsPath = path.join(assetsPath, TOOLS_DIRECTORY);
  await mkdir(toolsPath, { recursive: true });
  const writtenFiles = new Set<string>();
  for (const [fileName, tool] of toolFiles) {
    const { description, ...rest } = tool;
    const hasDescriptionFile = typeof description === 'string' && description !== '';
    await writeFile(path.join(toolsPath, fileName), JSON.stringify(hasDescriptionFile ? rest : tool, null, 2), 'utf-8');
    writtenFiles.add(fileName);
    if (hasDescriptionFile) {
      // The newline is only for editors that insist on one; reading takes it back off.
      await writeFile(path.join(toolsPath, descriptionFileName(fileName)), `${description}\n`, 'utf-8');
      writtenFiles.add(descriptionFileName(fileName));
    }
  }
  for (const fileName of await readdir(toolsPath)) {
    if (!writtenFiles.has(fileName)) {
      await rm(path.join(toolsPath, fileName));
    }
  }
}

/** Every `*.json` in the tools directory, by file name. */
async function readToolFiles(toolsPath: string): Promise<Map<string, JsonObject>> {
  const toolFiles = new Map<string, JsonObject>();
  for (const fileName of await readdir(toolsPath)) {
    if (!fileName.endsWith('.json')) {
      continue;
    }
    const tool: unknown = JSON.parse(await readFile(path.join(toolsPath, fileName), 'utf-8'));
    if (!isJsonObject(tool)) {
      throw new Error(`${TOOLS_DIRECTORY}/${fileName} does not hold a tool`);
    }
    const description = await readFile(path.join(toolsPath, descriptionFileName(fileName)), 'utf-8').catch(
      () => undefined,
    );
    toolFiles.set(
      fileName,
      description === undefined ? tool : { ...tool, description: description.replace(/\n$/, '') },
    );
  }
  return toolFiles;
}

/** Reads the committed config with every tool put back where ElevenLabs lists it. */
export async function readAgentConfig(assetsPath = ASSETS_PATH): Promise<Partial<GetAgentResponseModel>> {
  const configPath = path.join(assetsPath, CONFIG_FILE);
  const config = JSON.parse(await readFile(configPath, 'utf-8'));

  const prompt = isJsonObject(config) ? promptOf(config) : undefined;
  if (prompt) {
    Object.assign(prompt, joinTools(prompt, await readToolFiles(path.join(assetsPath, TOOLS_DIRECTORY))));
  }

  return config;
}
