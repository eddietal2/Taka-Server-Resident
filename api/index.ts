import { handle } from 'hono/vercel';

import { app } from '../src/index.js';

// Prisma needs the Node.js runtime; the Edge runtime is not supported.
export const config = {
  runtime: 'nodejs',
};

export default handle(app);
