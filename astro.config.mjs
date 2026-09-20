import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://feitto.com.br',
  image: {
    // as fotos do ensaio entram em 4097x6144; o Astro gera os tamanhos servidos
    responsiveStyles: true,
  },
  build: { inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
});
