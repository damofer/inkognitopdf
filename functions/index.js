// Cloud Functions of InkognitoPDF: only the timestamp relay (spec 040),
// served at /tsa through the rewrite in firebase.json.
import { onRequest } from "firebase-functions/v2/https";
import { relay } from "./relay.js";

export const tsa = onRequest(
  {
    region: "us-central1",
    // Some room for Node and firebase-functions while starting from cold.
    memory: "256MiB",
    // Two tries at the authority, 10 s each at most.
    timeoutSeconds: 30,
    maxInstances: 3,
    invoker: "public",
  },
  async (req, res) => {
    const reply = await relay({
      method: req.method,
      contentType: req.get("content-type"),
      body: req.rawBody,
    });
    res.status(reply.status).set(reply.headers ?? {});
    if (reply.body) res.send(Buffer.from(reply.body));
    else res.end();
  },
);
