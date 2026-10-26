'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !Object.prototype.hasOwnProperty.call(process.env, m[1])) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
loadEnv();
const PORT = Number(process.env.PORT || 4173);
const API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon' };

function send(res, code, body, type='application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function getBody(req, limit=50000) {
  return new Promise((resolve, reject) => {
    let raw='';
    req.on('data', chunk => { raw += chunk; if (raw.length > limit) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('BAD_JSON')); } });
    req.on('error', reject);
  });
}
function textFromResponse(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts=[];
  for (const item of (data.output || [])) for (const c of (item.content || [])) if (c.type === 'output_text' && c.text) parts.push(c.text);
  return parts.join('\n').trim();
}
async function chat(req, res) {
  let body;
  try { body = await getBody(req); } catch (e) { return send(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'La solicitud no es válida.' }); }
  if (!API_KEY) return send(res, 503, { error: 'Falta configurar OPENAI_API_KEY en el archivo .env.' });
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const safeMessages = messages.filter(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string').map(m => ({role:m.role, content:m.content.slice(0,4000)}));
  const system = `Eres Mimi, la mascota asistente amable, expresiva y útil de Ahorra+, una aplicación de finanzas personales. Responde en español claro, natural y cercano, salvo que el usuario pida otro idioma. Puedes ayudar con preguntas generales, redacción, estudio, tecnología, ideas, matemáticas y finanzas personales. Responde de forma directa y útil; explica paso a paso si hace falta y pregunta si falta contexto. No afirmes que hiciste acciones que no puedes realizar. En finanzas, ofrece información educativa, no garantías ni promesas de rentabilidad; advierte sobre riesgos y evita recomendar endeudarse irresponsablemente. El contexto de Ahorra+ es información privada proporcionada por la aplicación; úsala solo si es relevante y nunca inventes cifras. Si no hay sesión, dilo cuando se solicite información personal de la app. Moneda y datos registrados: ${JSON.stringify(context).slice(0,12000)}. Mantén las respuestas moderadamente breves y cálidas, puedes usar algún emoji sin exagerar.`;
  const input = [system, ...safeMessages.map(m => `${m.role === 'user' ? 'USUARIO' : 'MIMI'}: ${m.content}`)].join('\n\n');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method:'POST', signal:controller.signal,
      headers:{ 'Authorization':`Bearer ${API_KEY}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ model:MODEL, input, max_output_tokens:850 }),
    });
    clearTimeout(timeout);
    const raw = await upstream.text();
    let payload; try { payload=JSON.parse(raw); } catch { payload={}; }
    if (!upstream.ok) {
      console.error('AI provider returned', upstream.status, payload.error?.message || 'unknown error');
      return send(res, 502, { error: 'No pude conectar con la IA en este momento. Revisa la clave, el modelo y tu conexión.' });
    }
    const reply = textFromResponse(payload);
    if (!reply) return send(res, 502, { error: 'La IA no devolvió una respuesta. Inténtalo otra vez.' });
    return send(res, 200, { reply, mode:'ai' });
  } catch (e) {
    console.error('AI request failed:', e.message);
    return send(res, 502, { error: 'No pude conectar con la IA. Comprueba tu conexión a Internet e inténtalo de nuevo.' });
  }
}
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && url.pathname === '/api/chat') return chat(req,res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res,405,{error:'Método no permitido.'});
  let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const full = path.resolve(ROOT, '.' + pathname);
  if (!full.startsWith(ROOT + path.sep) && full !== path.join(ROOT,'index.html')) return send(res,403,{error:'Prohibido.'});
  if (path.basename(full) === '.env' || path.basename(full) === 'server.js' || path.basename(full) === 'package.json') return send(res,404,{error:'No encontrado.'});
  fs.readFile(full, (err, data) => {
    if (err) return send(res,404,{error:'Archivo no encontrado.'});
    res.writeHead(200, {'Content-Type':TYPES[path.extname(full)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`Ahorra+ abierto en http://127.0.0.1:${PORT}`));
