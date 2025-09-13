import { System } from "../extension/system";

export async function loadSingleRemoteForPreview(
  remotePath: string,
  system: System
): Promise<{ text: string; language: string } | null> {
  try {
    const response = await (
      await import("../miiservice/readfileservice")
    ).readFileService.call(system, remotePath);
    if (!response || (response as any).Rowsets?.FatalError) return null;
    const rows = (response as any).Rowsets?.Rowset?.Row || [];
    const payload = rows.find((r: any) => r.Name === "Payload");
    if (!payload) return null;
    const valueBuffer = Buffer.from(payload.Value, "base64");
    let text = "";
    try {
      text = valueBuffer.toString("utf8");
    } catch {
      text = valueBuffer.toString();
    }
    // Linguagem heurística simples
    const lower = remotePath.toLowerCase();
    let language = "plaintext";
    if (lower.endsWith(".ts")) language = "typescript";
    else if (lower.endsWith(".js")) language = "javascript";
    else if (lower.endsWith(".json")) language = "json";
    else if (lower.endsWith(".html") || lower.endsWith(".htm"))
      language = "html";
    else if (lower.endsWith(".css")) language = "css";
    else if (lower.endsWith(".sql")) language = "sql";
    else if (lower.endsWith(".xml")) language = "xml";
    else if (lower.endsWith(".md")) language = "markdown";
    return { text, language };
  } catch {
    return null;
  }
}
