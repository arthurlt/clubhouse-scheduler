// Secret bindings are provided at runtime via `.dev.vars` (local) or
// `wrangler secret put` (deployed). They are not declared in wrangler.jsonc, so
// we augment the generated `Env` interface here.
interface Env {
  SESSION_SECRET?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
}
