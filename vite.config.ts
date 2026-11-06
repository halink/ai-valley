import { defineConfig } from 'vite';
export default defineConfig({
 base:'/ai-town/',
 build:{outDir:'dist'},
 server:{proxy:{'/ai-town/api':'http://127.0.0.1:3412'}},
});
