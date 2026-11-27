// Berkas font di-inline sebagai data URI oleh Vite (assetsInlineLimit) dan esbuild (loader dataurl).
declare module '*.woff2' { const url: string; export default url; }
