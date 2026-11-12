import multipart from '@fastify/multipart';
import {
  API_PREFIX,
  isDateFormat,
  type HealthResponse,
} from '@selfsign/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { detectImage, FieldStorage, type StoredImage } from './storage.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function registerApi(app: FastifyInstance, dataDir: string): Promise<void> {
  const storage = await FieldStorage.open(dataDir);
  await app.register(
    async (api) => {
      await api.register(multipart, { limits: { fileSize: Infinity } });
      api.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));

      api.get('/values', async () => storage.listValues());

      api.post('/values', async (request, reply) => {
        const body = asRecord(request.body);
        const label = parseLabel(body?.['label']);
        const text = body?.['text'];
        if (!label || typeof text !== 'string' || text.length === 0) {
          return reply.code(400).send({ error: 'Label and value are required; label must be 1 to 100 characters.' });
        }
        return reply.code(201).send(await storage.createTextValue(label, text));
      });

      api.post('/values/image', async (request, reply) => {
        const upload = await readImageUpload(request);
        if ('error' in upload) return reply.code(upload.status).send({ error: upload.error });
        const label = parseLabel(upload.label);
        if (!label) return reply.code(400).send({ error: 'Label is required and must be 1 to 100 characters.' });
        const image = detectUploadedImage(upload.bytes);
        if (!image) return reply.code(415).send({ error: 'Only PNG and JPEG images are supported.' });
        return reply.code(201).send(await storage.createImageValue(label, image));
      });

      api.put<{ Params: { id: string } }>('/values/:id', async (request, reply) => {
        if (!isUuid(request.params.id)) return reply.code(400).send({ error: 'Invalid value ID.' });
        const body = asRecord(request.body);
        const label = parseLabel(body?.['label']);
        const text = body?.['text'];
        if (!label || (text !== undefined && (typeof text !== 'string' || text.length === 0))) {
          return reply.code(400).send({ error: 'Label and value are invalid.' });
        }
        const value = await storage.updateValue(request.params.id, label, text as string | undefined);
        return value ? reply.send(value) : reply.code(404).send({ error: 'Saved value not found.' });
      });

      api.put<{ Params: { id: string } }>('/values/:id/image', async (request, reply) => {
        if (!isUuid(request.params.id)) return reply.code(400).send({ error: 'Invalid value ID.' });
        const current = storage.listValues().find((value) => value.id === request.params.id);
        if (!current) return reply.code(404).send({ error: 'Saved value not found.' });
        if (current.kind !== 'image') return reply.code(400).send({ error: 'Saved value is not an image.' });
        const upload = await readImageUpload(request);
        if ('error' in upload) return reply.code(upload.status).send({ error: upload.error });
        const label = upload.label === undefined ? undefined : parseLabel(upload.label);
        if (upload.label !== undefined && !label) {
          return reply.code(400).send({ error: 'Label must be 1 to 100 characters.' });
        }
        const image = detectUploadedImage(upload.bytes);
        if (!image) return reply.code(415).send({ error: 'Only PNG and JPEG images are supported.' });
        const value = await storage.replaceImage(request.params.id, image, label);
        return value ? reply.send(value) : reply.code(404).send({ error: 'Saved value not found.' });
      });

      api.delete<{ Params: { id: string } }>('/values/:id', async (request, reply) => {
        if (!isUuid(request.params.id)) return reply.code(400).send({ error: 'Invalid value ID.' });
        return (await storage.deleteValue(request.params.id))
          ? reply.code(204).send()
          : reply.code(404).send({ error: 'Saved value not found.' });
      });

      api.put('/values/order', async (request, reply) => {
        const ids = asRecord(request.body)?.['ids'];
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !isUuid(id))) {
          return reply.code(400).send({ error: 'IDs must be a permutation of saved value IDs.' });
        }
        const values = await storage.reorderValues(ids);
        return values ? reply.send(values) : reply.code(400).send({ error: 'IDs must be a permutation of saved value IDs.' });
      });

      api.get('/settings', async () => storage.getSettings());

      api.put('/settings', async (request, reply) => {
        const dateFormat = asRecord(request.body)?.['dateFormat'];
        if (!isDateFormat(dateFormat)) return reply.code(400).send({ error: 'Invalid date format.' });
        return reply.send(await storage.updateSettings({ dateFormat }));
      });

      api.get<{ Params: { id: string } }>('/images/:id', async (request, reply) => {
        if (!isUuid(request.params.id)) return reply.code(400).send({ error: 'Invalid image ID.' });
        const image = await storage.getImage(request.params.id);
        return image
          ? reply.type(image.mimeType).send(image.bytes)
          : reply.code(404).send({ error: 'Image not found.' });
      });
    },
    { prefix: API_PREFIX },
  );
}

type UploadResult =
  | { label?: string; bytes: Buffer }
  | { status: 400 | 415; error: string };

async function readImageUpload(request: FastifyRequest): Promise<UploadResult> {
  let label: string | undefined;
  let bytes: Buffer | undefined;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (bytes) return { status: 400, error: 'Only one image file may be uploaded.' };
      bytes = await part.toBuffer();
    } else if (part.fieldname === 'label' && typeof part.value === 'string') {
      label = part.value;
    }
  }
  if (!bytes) return { status: 400, error: 'An image file is required.' };
  return { label, bytes };
}

function detectUploadedImage(bytes: Buffer): StoredImage | undefined {
  const mimeType = detectImage(bytes);
  return mimeType ? { bytes, mimeType } : undefined;
}

function parseLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.trim();
  return label.length >= 1 && label.length <= 100 ? label : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
