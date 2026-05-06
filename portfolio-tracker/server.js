import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ Falta ANTHROPIC_API_KEY en el archivo .env');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Endpoint de refresco de precios
app.post('/api/refresh-prices', async (req, res) => {
  try {
    const { cryptoSymbols = [], stockTickers = [], fxNeeded = [] } = req.body;

    if (cryptoSymbols.length === 0 && stockTickers.length === 0 && fxNeeded.length === 0) {
      return res.json({ crypto: {}, stocks: {}, fx: {} });
    }

    const prompt = `Necesito los precios actuales (lo más recientes posible). Busca en la web los siguientes datos y responde EXCLUSIVAMENTE con un objeto JSON válido, sin markdown, sin texto adicional, sin backticks.

${cryptoSymbols.length > 0 ? `CRIPTOMONEDAS (precio en EUR): ${cryptoSymbols.join(', ')}` : ''}
${stockTickers.length > 0 ? `ACCIONES (precio en su divisa de cotización): ${stockTickers.join(', ')}. Para tickers con sufijo (.MC=Madrid, .UK=Londres, .DE=Frankfurt, .PA=París) usa la divisa local. Sin sufijo asume USD.` : ''}
${fxNeeded.length > 0 ? `TIPOS DE CAMBIO (cuántas unidades de cada divisa equivalen a 1 EUR): ${fxNeeded.join(', ')}` : ''}

Formato JSON exacto:
{
  "crypto": { "BTC": 90000.50, "ETH": 3200.10 },
  "stocks": { "AAPL": { "price": 230.50, "currency": "USD" } },
  "fx": { "USD": 1.08, "GBP": 0.85 }
}

Si no encuentras un precio concreto, omítelo del JSON. Solo el JSON, nada más.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    });

    const fullText = (response.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    let jsonStr = fullText.trim();
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(jsonStr);
    res.json({
      crypto: parsed.crypto || {},
      stocks: parsed.stocks || {},
      fx: parsed.fx || {},
    });
  } catch (err) {
    console.error('Error refresh-prices:', err);
    res.status(500).json({ error: err.message || 'Error desconocido' });
  }
});

// Servir frontend en producción
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✓ Backend escuchando en http://localhost:${PORT}`);
});
