import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { store } from './store';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <QueryClientProvider client={queryClient}>
      <HelmetProvider>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: {
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: '14px',
              borderRadius: '4px',
              boxShadow: '0 4px 24px rgba(26,35,126,0.1)',
            },
            success: { iconTheme: { primary: '#1A237E', secondary: '#fff' } },
          }}
        />
      </HelmetProvider>
    </QueryClientProvider>
  </Provider>
);
