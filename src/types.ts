/**
 * Shared Hono environment bindings. Values are attached by middleware and read
 * by route handlers via `c.get(...)`.
 */
export type AppEnv = {
  Variables: {
    /** Phone number proven by the verification token. */
    verificationPhone: string;
  };
};
