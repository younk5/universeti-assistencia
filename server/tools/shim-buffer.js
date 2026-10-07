// Injeta `Buffer` no bundle do @vercel/blob para navegador (o SDK o usa em
// caminhos internos). Veja server/tools/gerar-vendor-blob.js.
import { Buffer } from 'buffer';

export { Buffer };
