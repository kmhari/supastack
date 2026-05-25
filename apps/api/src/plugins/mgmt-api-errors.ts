/**
 * Cloud-shape error envelope for the Supabase CLI compatibility surface.
 *
 * Spec: specs/003-supabase-cli-compat-p0/contracts/error-envelope.md
 *
 * Dashboard routes keep their existing `{ error: { code, message } }` shape
 * via the global setErrorHandler in server.ts. This plugin re-formats any
 * error thrown inside the `/v1` route group as `{ message, code?, details? }`
 * — the shape the upstream Supabase CLI's generated Go client expects.
 *
 * Register this plugin BEFORE the management routes (it scopes via Fastify's
 * encapsulation; only requests inside the scope it's registered under see
 * this error handler).
 */
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError } from '@selfbase/shared';

/**
 * Domain error type. Routes throw `new ManagementApiError(...)` to emit a
 * fully-specified envelope; the plugin formats it untouched.
 */
export class ManagementApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    message: string,
    code: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ManagementApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

interface Envelope {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

function envelopeFromZod(err: ZodError): Envelope {
  return {
    message: err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    code: 'validation',
    details: { issues: err.issues },
  };
}

/**
 * Wrapped with fastify-plugin (fp) so the setErrorHandler call lands on the
 * PARENT scope (the /v1 register block), not on this plugin's own inner
 * encapsulation context. Without fp, sibling routes registered separately
 * within /v1 would NOT see this handler — Fastify only propagates errors
 * up the encapsulation tree, never sideways. Symptom was 500 internal-error
 * envelopes for every catch-all/route-thrown error instead of the intended
 * scoped envelope.
 */
const plugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((err: Error & Partial<FastifyError>, req, reply) => {
    // Our domain error — pass through as-is.
    if (err instanceof ManagementApiError) {
      const body: Envelope = { message: err.message, code: err.code };
      if (err.details) body.details = err.details;
      reply.status(err.statusCode).send(body);
      return;
    }

    // Selfbase's existing AppError shape (used by requireAuth and most
    // shared services). Translate the dashboard envelope into the cloud
    // shape so CLI consumers see `{message, code}` instead of `{error: {...}}`.
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({
        message: err.message,
        code: err.code,
        ...(err.details ? { details: err.details as Record<string, unknown> } : {}),
      });
      return;
    }

    // Zod validation error — surface a 422 with issue detail.
    if (err instanceof ZodError) {
      reply.status(422).send(envelopeFromZod(err));
      return;
    }

    // Fastify's built-in JSON-schema / route-level validation errors.
    if (err.validation) {
      reply.status(400).send({ message: err.message, code: 'bad_request' });
      return;
    }

    // Body too large — Fastify emits a `FST_ERR_CTP_BODY_TOO_LARGE`.
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      reply.status(413).send({
        message: 'Request body exceeds the configured limit',
        code: 'payload_too_large',
      });
      return;
    }

    // Anything else — log + 500 with a generic envelope. NEVER leak err.message
    // verbatim to avoid disclosing internals.
    req.log.error({ err }, 'unhandled mgmt-api error');
    reply.status(500).send({
      message: 'Internal server error',
      code: 'internal',
    });
  });
};

export const mgmtApiErrorsPlugin = fp(plugin);
