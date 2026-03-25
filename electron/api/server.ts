import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PORTS } from '../utils/config';
import { logger } from '../utils/logger';
import type { HostApiContext } from './context';
import { handleAppRoutes } from './routes/app';
import { handleGatewayRoutes } from './routes/gateway';
import { handleSettingsRoutes } from './routes/settings';
import { handleProviderRoutes } from './routes/providers';
import { handleAgentRoutes } from './routes/agents';
import { handleChannelRoutes } from './routes/channels';
import { handleLogRoutes } from './routes/logs';
import { handleUsageRoutes } from './routes/usage';
import { handleSkillRoutes } from './routes/skills';
import { handleFileRoutes } from './routes/files';
import { handleSessionRoutes } from './routes/sessions';
import { handleCronRoutes } from './routes/cron';
import { sendJson } from './route-utils';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
) => Promise<boolean>;

const routeHandlers: RouteHandler[] = [
  handleAppRoutes,
  handleGatewayRoutes,
  handleSettingsRoutes,
  handleProviderRoutes,
  handleAgentRoutes,
  handleChannelRoutes,
  handleSkillRoutes,
  handleFileRoutes,
  handleSessionRoutes,
  handleCronRoutes,
  handleLogRoutes,
  handleUsageRoutes,
];

/** Maximum number of alternative ports to try when the default port is unavailable. */
const MAX_PORT_RETRIES = 5;

/**
 * The port that the Host API server is actually listening on.
 * This may differ from the configured default if the default port was unavailable.
 * Returns `null` if no server has been started or all ports failed.
 */
let actualPort: number | null = null;

export function getHostApiPort(): number | null {
  return actualPort;
}

/**
 * Try to start an HTTP server on the given port.
 * Returns a promise that resolves with the server on success,
 * or rejects on binding error (EACCES, EADDRINUSE, etc.).
 */
function tryListen(server: Server, port: number, host: string): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export async function startHostApiServer(
  ctx: HostApiContext,
  preferredPort = PORTS.CLAWX_HOST_API,
): Promise<Server> {
  const host = '127.0.0.1';

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${host}:${actualPort ?? preferredPort}`);
      for (const handler of routeHandlers) {
        if (await handler(req, res, requestUrl, ctx)) {
          return;
        }
      }
      sendJson(res, 404, { success: false, error: `No route for ${req.method} ${requestUrl.pathname}` });
    } catch (error) {
      logger.error('Host API request failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
  });

  // Attach a persistent error handler so any later runtime errors
  // (e.g. connection resets) are logged instead of crashing the process.
  server.on('error', (error) => {
    logger.error('Host API server error:', error);
  });

  // Try the preferred port first, then fall back to adjacent ports.
  for (let attempt = 0; attempt <= MAX_PORT_RETRIES; attempt++) {
    const port = preferredPort + attempt;
    try {
      await tryListen(server, port, host);
      actualPort = port;
      if (attempt > 0) {
        logger.warn(
          `Host API: default port ${preferredPort} was unavailable; ` +
          `listening on fallback port ${port} instead`,
        );
      }
      logger.info(`Host API server listening on http://${host}:${port}`);
      return server;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EADDRINUSE') {
        logger.warn(`Host API: port ${port} unavailable (${code}), trying next port...`);
        continue;
      }
      // Unexpected error — don't retry, just log and break.
      logger.error(`Host API: unexpected error binding port ${port}:`, error);
      break;
    }
  }

  // All ports failed — log a clear warning but DON'T crash the app.
  logger.error(
    `Host API server failed to bind to any port ` +
    `(tried ${preferredPort}–${preferredPort + MAX_PORT_RETRIES}). ` +
    `UI features that depend on the Host API will be unavailable.`,
  );
  actualPort = null;
  return server;
}
