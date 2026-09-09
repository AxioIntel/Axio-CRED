import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { analysisConnection } from '../backend/dist/analysis-provider.js';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const connection = analysisConnection();
if (!connection.configured) {
  console.error(connection.configurationError);
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(connection.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', ...(connection.provider === 'azure'
        ? { 'api-key': connection.key } : { Authorization: `Bearer ${connection.key}` }) },
      body: JSON.stringify({ model: connection.model, input: 'Reply with OK.', max_output_tokens: 32, store: false })
    });
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch {
      console.error(JSON.stringify({ httpStatus: response.status, error: 'Provider returned a non-JSON response', contentType: response.headers.get('content-type') }));
      process.exit(1);
    }
    const completed = response.ok && data.status === 'completed' && data.output?.some(item => item.content?.some(part => part.type === 'output_text' && part.text?.trim()));
    console.log(JSON.stringify({ provider: connection.provider, deployment: connection.model,
      httpStatus: response.status, completed: Boolean(completed),
      errorCode: typeof data.error?.code === 'string' && /^[A-Za-z0-9_]+$/.test(data.error.code) ? data.error.code : undefined,
      usage: response.ok ? data.usage : undefined }));
    if (!completed) process.exitCode = 1;
  } catch (error) {
    const code = error?.cause?.code ?? error?.name;
    console.error(JSON.stringify({ error: 'Connection test failed before a usable response', code: /^[A-Za-z0-9_]+$/.test(String(code)) ? code : 'unknown' }));
    process.exitCode = 1;
  }
}
