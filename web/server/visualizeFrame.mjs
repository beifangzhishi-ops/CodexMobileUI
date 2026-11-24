const staticSources = 'https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net ' +
  'https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://fonts.bunny.net ' +
  'https://persistent.oaistatic.com/plugins/visualize/';

export const VISUALIZE_FRAME_CSP = [
  'sandbox allow-scripts', "default-src 'none'", "frame-ancestors 'self'",
  `script-src 'unsafe-inline' ${staticSources}`, `style-src 'unsafe-inline' ${staticSources}`,
  `img-src data: blob: ${staticSources}`, `font-src data: ${staticSources}`,
  "base-uri 'none'", "form-action 'none'",
].join('; ');

// Increment when the wrapper or its styles change, so cached frames revalidate.
export const VISUALIZE_FRAME_VERSION = '1';

export function visualizeFrame(fragment) {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    color-scheme: light dark;
    --background: light-dark(#fff, #171717);
    --foreground: light-dark(#242424, #eee);
    --card: light-dark(#f6f6f6, #252525);
    --card-foreground: var(--foreground);
    --popover: var(--card);
    --popover-foreground: var(--foreground);
    --primary: light-dark(#222, #ededed);
    --primary-foreground: var(--background);
    --secondary: var(--card);
    --secondary-foreground: var(--foreground);
    --muted: light-dark(#efefef, #303030);
    --muted-foreground: light-dark(#646464, #aaa);
    --accent: light-dark(#e5ecf7, #29364b);
    --accent-foreground: var(--foreground);
    --border: light-dark(#ddd, #444);
    --input: var(--border);
    --ring: #648ad0;
    --blue: #638cdb; --orange: #cf8449; --green: #539c77;
    --red: #d56563; --purple: #9872ce; --yellow: #b69a38;
    --destructive: var(--red);
    --viz-series-1: var(--blue); --viz-series-2: var(--orange); --viz-series-3: var(--green);
    --viz-series-4: var(--purple); --viz-series-5: var(--red); --viz-series-6: var(--yellow);
    --font-size-base: 14px;
    color: var(--foreground);
    font: var(--font-size-base)/1.5 system-ui, sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; padding: 4px; overflow-wrap: anywhere; }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: 1.4em; } h2 { font-size: 1.2em; } h3 { font-size: 1.05em; }
  button, input, select, textarea { font: inherit; }
  button, .btn { padding: .4em .7em; border: 1px solid var(--border); border-radius: 7px;
    background: var(--card); color: var(--foreground); }
  .btn-primary, [aria-pressed="true"], .nav-link.active {
    background: var(--primary); color: var(--primary-foreground);
  }
  .form-control, .form-select { padding: .4em; border: 1px solid var(--input); border-radius: 6px; }
  .form-range { display: block; width: 100%; accent-color: var(--viz-series-1); }
  .form-label { display: block; }
  .form-check, .nav, .viz-controls, .viz-row {
    display: flex; flex-wrap: wrap; align-items: center; gap: .55em;
  }
  .viz-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,140px),1fr)); gap: .65em; }
  .card { background: var(--card); border-radius: 8px; padding: .7em; }
  .viz-badge { background: var(--accent); color: var(--accent-foreground); padding: .15em .5em; border-radius: 1em; }
  .progress { height: .5em; overflow: hidden; border-radius: 2em; background: var(--muted); }
  .progress-bar { height: 100%; background: var(--viz-series-1); }
  .tabular-nums { font-variant-numeric: tabular-nums; }
  .text-small { font-size: .86em; } .text-muted { color: var(--muted-foreground); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  img, svg, canvas { max-width: 100%; }
  [hidden] { display: none !important; }
  @media (pointer: coarse) {
    button, .btn, .form-range { min-height: 44px; }
    .form-control, .form-select { font-size: max(16px, 1em); }
  }
</style>
<script>
  addEventListener('DOMContentLoaded', () => {
    let previous = 0;
    const report = () => {
      const height = Math.ceil(document.body.getBoundingClientRect().height);
      if (height > 0 && height !== previous) {
        previous = height;
        parent.postMessage({ type: 'codexmobileui:visualize-height', height }, '*');
      }
    };
    new ResizeObserver(report).observe(document.body);
    report();
    document.querySelectorAll('[role="tablist"]').forEach((group) => {
      const tabs = Array.from(group.querySelectorAll('[role="tab"]'));
      group.addEventListener('click', (event) => {
        const selected = event.target.closest('button[role="tab"]');
        if (!tabs.includes(selected) || selected.disabled || selected.getAttribute('aria-disabled') === 'true') return;
        tabs.forEach((tab) => {
          const active = tab === selected;
          tab.setAttribute('aria-selected', String(active));
          tab.classList.toggle('active', active);
          const panel = document.getElementById(tab.getAttribute('aria-controls'));
          if (panel) panel.hidden = !active;
        });
      });
    });
  }, { once: true });
</script>
</head>
<body>${fragment}</body>
</html>`;
}
