import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import './design/fontes.css';
import './design/tokens.css';
import './design/base.css';
import './design/layout.css';
import './design/componentes.css';
import './design/paginas.css';
import './design/paginas-a.css';
import './design/paginas-b.css';
import './design/paginas-c.css';
import './design/paginas-jornada.css';
import './design/impressao.css';
import './design/paginas-regularidade.css';
import { ErroApi } from './api/cliente';
import { roteador } from './app/roteador';

const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Erros 4xx (permissão, validação, não encontrado) não melhoram com nova tentativa.
      retry: (falhas, erro) => !(erro instanceof ErroApi && erro.status >= 400 && erro.status < 500) && falhas < 2,
    },
    mutations: { retry: false },
  },
});

const elementoRaiz = document.getElementById('raiz');
if (!elementoRaiz) throw new Error('Elemento #raiz não encontrado em index.html.');

createRoot(elementoRaiz).render(
  <StrictMode>
    <QueryClientProvider client={clienteConsultas}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>
  </StrictMode>,
);
