import { defineConfig } from 'tsdown'

// Host 半边：Node 库，输出 lib/，供 cordis.yml 插件行按包名加载。
const lib = {
  entry: { index: 'src/index.ts', invariant: 'src/invariant.ts', 'web-server': 'src/web-server.ts' },
  outDir: 'lib',
  format: 'esm' as const,
  platform: 'node' as const,
  target: 'node20',
  dts: true,
  clean: true,
  external: [/^@deepseek-ai\//, /^cordis/, 'ssh2', /^node:/],
}

// Client 半边：浏览器 bundle，交给 DSH 的 client-modules 分发。
// 产物必须是 __ModuleLoader__.load 握手格式：CJS 输出 + banner/footer 包裹，
// 工厂通过注入的 require 从浏览器模块表解析 react externals。
// externals 只允许浏览器平台模块表里有的包（react 系列）；
// 其余依赖一律内联（noExternal），防止 require 到模块表回答不了的 specifier。
const CLIENT_EXTERNALS = ['react', 'react-dom', 'react/jsx-runtime']

const client = {
  name: 'dsh-lab-controller/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs' as const,
  platform: 'browser' as const,
  target: 'es2020',
  dts: false,
  clean: false,
  sourcemap: true,
  external: CLIENT_EXTERNALS,
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    // 固定产物名 lib/client.js，与 package.json exports["./client"] 对应。
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-lab-controller", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

// 数组形式：先构建 Node 库（clean），再产出 client bundle（clean 关闭，避免互相清掉）。
const web = {
  name: 'dsh-lab-controller/web',
  entry: { web: 'src/web/index.tsx' },
  outDir: 'lib',
  format: 'esm' as const,
  platform: 'browser' as const,
  target: 'es2020',
  dts: false,
  clean: false,
  sourcemap: true,
  noExternal: /.*/,
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  outputOptions: { entryFileNames: 'web.js' },
}

export default defineConfig([lib, client, web])
