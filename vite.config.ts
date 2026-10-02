import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const backend = `http://127.0.0.1:${process.env.PORT ?? '3001'}`;
export default defineConfig({plugins:[react()],server:{port:Number(process.env.WEB_PORT ?? 5173),strictPort:true,proxy:{'/socket.io':{target:backend,ws:true},'/api':backend}},build:{chunkSizeWarningLimit:1200}});
