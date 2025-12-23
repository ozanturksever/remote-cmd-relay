import { defineApp } from "convex/server";
import remoteCmdRelay from "../../packages/convex/src/convex.config";

const app = defineApp();
app.use(remoteCmdRelay);

export default app;
