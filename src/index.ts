import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvFile } from "./loadEnv.js";
import { createGoogleWorkspaceMcpServer } from "./serverFactory.js";

loadEnvFile();

async function main() {
  const server = createGoogleWorkspaceMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
