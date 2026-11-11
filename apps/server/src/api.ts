import { API_PREFIX, type HealthResponse } from '@selfsign/shared';
import type { FastifyInstance } from 'fastify';

export async function registerApi(app: FastifyInstance): Promise<void> {
  await app.register(
    async (api) => {
      api.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
    },
    { prefix: API_PREFIX },
  );
}
