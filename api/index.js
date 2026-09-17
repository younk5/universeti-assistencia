import { criarHandler } from '../server/app.js';

/**
 * Entrypoint serverless da Vercel.
 *
 * Um único arquivo atende todo o /api/* (o roteamento interno é feito pelo
 * Roteador do projeto). O `vercel.json` reescreve qualquer /api/... para cá,
 * porque o catch-all do builder estático da Vercel só cobre um segmento.
 *
 * Os arquivos de public/ (HTML, CSS, JS) são servidos pela CDN e não passam
 * por esta função.
 */
export default criarHandler({ servirEstaticos: false });

export const config = {
  maxDuration: 30,
};
