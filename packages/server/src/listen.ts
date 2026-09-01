import { startServer } from "./index.ts";

const port = Number(process.env.PORT ?? 8787);
startServer(port);
console.log(`war2 server ws://localhost:${port}/ws`);
