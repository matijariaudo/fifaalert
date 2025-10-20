// node get_emails.js
import fs from 'fs';
import { google } from 'googleapis';
import readline from 'readline';

const CREDENTIALS_PATH = './data_email/credentials.json';
const TOKEN_PATH = './data_email/token.json';
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

/** Helpers */
function base64UrlDecode(base64url) {
  // Gmail uses base64url (replace -_ -> +/)
  base64url = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // pad
  while (base64url.length % 4) base64url += '=';
  return Buffer.from(base64url, 'base64').toString('utf8');
}

function getHeader(headers, name) {
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

/** Load credentials */
if (!fs.existsSync(CREDENTIALS_PATH)) {
  console.error('=> Coloca credentials.json (OAuth client) en el mismo folder.');
  process.exit(1);
}
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

/** Create OAuth2 client */
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

async function askCode(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(ans); }));
}

async function authorize() {
  try {
    // Si existe token previo
    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      oAuth2Client.setCredentials(token);

      // Escucha renovación automática
      oAuth2Client.on('tokens', (tokens) => {
        if (tokens.refresh_token || tokens.access_token) {
          console.log('🔁 Token actualizado, guardando en disco...');
          const merged = { ...token, ...tokens };
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
        }
      });

      return oAuth2Client;
    }

    // Si no hay token aún
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES
    });
    console.log('Abre esta URL y pegá el código aquí:\n', authUrl);
    const code = await askCode('Código: ');
    const { tokens } = await oAuth2Client.getToken(code.trim());
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('Token guardado en', TOKEN_PATH);
    return oAuth2Client;
  } catch (err) {
    console.error('❌ Error de autorización:', err.message);
    // Borra token corrupto y reintenta
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
    console.log('🔄 Token borrado. Intentando de nuevo...');
    return authorize();
  }
}


async function listAndReadLatestEmails(maxResults = 5) {
  const auth = await authorize();
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.messages.list({ userId: 'me', maxResults, q: '' });
  const messages = res.data.messages || [];
  if (messages.length === 0) {
    console.log('No hay mensajes.');
    return;
  }

  for (const m of messages) {
    const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const payload = msg.data.payload || {};
    const headers = payload.headers || [];

    const from = getHeader(headers, 'From');
    const subject = getHeader(headers, 'Subject');

    // sólo FIFA
    if (!from.toLowerCase().includes('fifa')) continue;

    // obtener cuerpo (similar a antes)
    let body = '';
    function walkParts(parts) {
      if (!parts) return;
      for (const p of parts) {
        if (p.mimeType === 'text/plain' && p.body && p.body.data)
          body += base64UrlDecode(p.body.data);
        else if (p.parts) walkParts(p.parts);
        else if (p.mimeType === 'text/html' && p.body && p.body.data && !body)
          body += base64UrlDecode(p.body.data);
      }
    }
    if (payload.body && payload.body.data) body = base64UrlDecode(payload.body.data);
    else if (payload.parts) walkParts(payload.parts);

    // buscar código numérico (prioriza 6 dígitos)
    const plain = body.replace(/<[^>]+>/g, ' ');
    const match = plain.match(/\b\d{6}\b/);
    if (match) {
      console.log('✅ Código FIFA encontrado:', match[0]);
      return match[0];
    }
  }

  console.log('No se encontró correo de FIFA con código.');
  return null;
}

export default async function get_code() {
  const codigo = await listAndReadLatestEmails(5);
  return codigo;
}