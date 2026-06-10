const API_BASE = "/api/rail-graph-aggregate";

export interface AggregateStorageRef {
  aggregateKey: string;
  file: string;
  path?: string;
}

export function sanitizeAggregateKey(value: string): string {
  return String(value || "default").replace(/[\\/:<>"|?*\x00-\x1f]/g, "_").slice(0, 120) || "default";
}

export async function readAggregateJson<T>(ref: AggregateStorageRef): Promise<T> {
  if (isNodeRuntime()) {
    const fsModule = "node:fs/promises";
    const pathModule = "node:path";
    const fs = await import(fsModule) as {
      readFile(path: string, encoding: "utf8"): Promise<string>;
    };
    const path = await import(pathModule) as {
      resolve(...parts: string[]): string;
      dirname(path: string): string;
    };
    const filePath = ref.path ?? path.resolve("aggregates", sanitizeAggregateKey(ref.aggregateKey), ref.file);
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  }

  const response = await fetch(`${API_BASE}/read`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ aggregateKey: ref.aggregateKey, file: ref.file }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to read aggregate file: ${ref.file}`);
  }
  return await response.json() as T;
}

export async function writeAggregateJson(ref: AggregateStorageRef, data: unknown): Promise<void> {
  if (isNodeRuntime()) {
    const fsModule = "node:fs/promises";
    const pathModule = "node:path";
    const fs = await import(fsModule) as {
      mkdir(path: string, options: { recursive: boolean }): Promise<void>;
      writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
    };
    const path = await import(pathModule) as {
      resolve(...parts: string[]): string;
      dirname(path: string): string;
    };
    const filePath = ref.path ?? path.resolve("aggregates", sanitizeAggregateKey(ref.aggregateKey), ref.file);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return;
  }

  const response = await fetch(`${API_BASE}/write`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ aggregateKey: ref.aggregateKey, file: ref.file, data }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to write aggregate file: ${ref.file}`);
  }
}

export function isNodeRuntime(): boolean {
  const maybeProcess = globalThis as unknown as { process?: { versions?: { node?: string } } };
  return !!maybeProcess.process?.versions?.node;
}
