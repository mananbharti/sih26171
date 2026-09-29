import {build} from 'esbuild';
import {mkdir,cp,writeFile} from 'node:fs/promises';
await mkdir('extension-build',{recursive:true});
await cp('dist','extension-build',{recursive:true});
await build({entryPoints:['extension/background.ts'],bundle:true,outfile:'extension-build/background.js',format:'esm',target:'chrome116'});
await build({entryPoints:['extension/content.ts'],bundle:true,outfile:'extension-build/content.js',format:'iife',target:'chrome116'});
await writeFile(
  'extension-build/manifest.json',
  JSON.stringify(
    {
      manifest_version: 3,
      name: 'ORVIA — Privacy-first browser agent',
      version: '1.0.0',
      minimum_chrome_version: '116',
      description:
        'Local page assistance with redaction, explicit form approval and privacy receipts. Prototype; no cloud AI.',
      permissions: ['activeTab', 'scripting', 'sidePanel', 'storage'],
      host_permissions: ['<all_urls>'],
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content.js'],
          run_at: 'document_idle',
        },
      ],
      action: { default_title: 'Open ORVIA' },
      side_panel: { default_path: 'sidepanel.html' },
      background: { service_worker: 'background.js', type: 'module' },
      content_security_policy: {
        extension_pages: "script-src 'self'; object-src 'self'; connect-src 'none'",
      },
    },
    null,
    2
  )
);
console.log('Chrome extension built in extension-build/');
