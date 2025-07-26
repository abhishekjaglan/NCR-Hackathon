import { githubServer } from "./server/server";

const server = new githubServer();
server.run().catch(() => {});