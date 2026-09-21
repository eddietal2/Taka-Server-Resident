/**
 * Shared Hono environment bindings. Values are attached by middleware and read
 * by route handlers via `c.get(...)`.
 */

/**
 * Who an uploaded object belongs to.
 *
 * An upload is authorised one of two ways, and they name the owner differently.
 * During sign-up the only proof is a freshly verified phone number, and the
 * account does not exist yet; afterwards the app holds an access token, whose
 * subject is a user id. The R2 key is built from whichever applies.
 */
export type UploadOwner = { kind: 'phone'; phone: string } | { kind: 'user'; userId: string };

export type AppEnv = {
  Variables: {
    /** Phone number proven by the verification token. */
    verificationPhone: string;
    /** Owner resolved by `requireUploadAuth`, for the presign route. */
    uploadOwner: UploadOwner;
    /** User id proven by an access token. */
    authenticatedUserId: string;
  };
};
